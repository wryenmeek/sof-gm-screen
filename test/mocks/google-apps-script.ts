import { vi } from "vitest";

export interface MockFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  content: string;
  updated: Date;
}

export function setupGoogleAppsScriptMocks(files: MockFile[] = []) {
  const fileStore = new Map<string, MockFile>();
  for (const f of files) {
    fileStore.set(f.id, f);
  }

  const propsStore = new Map<string, string>();
  const cacheStore = new Map<string, string>();
  const logs: string[] = [];
  const triggers: Array<{
    handlerFunction: string;
    weekDay?: string;
    hour?: number;
  }> = [];
  const lockState = { locked: false, waits: 0, releases: 0 };
  let activeUserEmail = "companion@example.test";
  let activeUserKey = "companion-temp-key";
  const Session = {
    getActiveUser: () => ({ getEmail: () => activeUserEmail }),
    getTemporaryActiveUserKey: () => activeUserKey
  };
  let lastCreatedTemplate: Record<string, any> | null = null;
  const sheetRows: any[][] = [];
  const taskStore: Array<{
    id: string;
    title: string;
    notes?: string;
    due?: string;
    status?: string;
  }> = [];

  const DriveApp = {
    getFileById: vi.fn((id: string) => {
      const f = fileStore.get(id);
      if (!f) throw new Error("File not found: " + id);
      return {
        getId: () => f.id,
        getName: () => f.name,
        getMimeType: () => f.mimeType,
        getSize: () => f.size,
        getLastUpdated: () => f.updated,
        getBlob: () => ({
          getDataAsString: () => f.content,
          getBytes: () => Buffer.from(f.content),
          getContentType: () => f.mimeType
        }),
        setContent: (newContent: string) => {
          f.content = newContent;
          f.updated = new Date();
        }
      };
    }),
    getFoldersByName: vi.fn((_name: string) => {
      return {
        hasNext: () => false,
        next: () => {
          throw new Error("No folder");
        }
      };
    }),
    getFolderById: vi.fn((folderId: string) => {
      const createFolder = (id: string, name: string) => ({
        getId: () => id,
        getName: () => name,
        getFiles: () => ({
          hasNext: () => false,
          next: () => null
        }),
        getFolders: () => ({
          hasNext: () => false,
          next: () => null
        }),
        getFoldersByName: (subName: string) => {
          let yielded = false;
          return {
            hasNext: () => !yielded,
            next: () => {
              if (yielded) throw new Error("No more folders");
              yielded = true;
              return createFolder("folder_" + subName, subName);
            }
          };
        },
        getFilesByName: (fileName: string) => {
          const matching = Array.from(fileStore.values()).filter(
            (f) => f.name === fileName
          );
          let idx = 0;
          return {
            hasNext: () => idx < matching.length,
            next: () => {
              const f = matching[idx++];
              return DriveApp.getFileById(f.id);
            }
          };
        },
        createFile: (name: string, content: string, mimeType: string) => {
          const newFile: MockFile = {
            id: "new_file_" + Date.now() + "_" + Math.random(),
            name,
            mimeType,
            size: content.length,
            content,
            updated: new Date()
          };
          fileStore.set(newFile.id, newFile);
          return DriveApp.getFileById(newFile.id);
        }
      });

      return createFolder(folderId || "mock_folder_id", "Sessions");
    })
  };

  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key: string) => propsStore.get(key) || null,
      getProperties: () => Object.fromEntries(propsStore.entries()),
      setProperty: (key: string, val: string) => propsStore.set(key, val),
      deleteProperty: (key: string) => propsStore.delete(key)
    })
  };

  const ScriptApp = {
    WeekDay: {
      MONDAY: "MONDAY",
      TUESDAY: "TUESDAY",
      WEDNESDAY: "WEDNESDAY",
      THURSDAY: "THURSDAY",
      FRIDAY: "FRIDAY",
      SATURDAY: "SATURDAY",
      SUNDAY: "SUNDAY"
    },
    getOAuthToken: () => "mock_oauth_token",
    getProjectTriggers: vi.fn(() =>
      triggers.map((t) => ({
        getHandlerFunction: () => t.handlerFunction,
        handlerFunction: t.handlerFunction
      }))
    ),
    deleteTrigger: vi.fn((trigger: { handlerFunction: string }) => {
      const index = triggers.findIndex(
        (entry) => entry.handlerFunction === trigger.handlerFunction
      );
      if (index >= 0) triggers.splice(index, 1);
    }),
    newTrigger: vi.fn((handlerFunction: string) => {
      let weekDay: string | undefined;
      let hour: number | undefined;
      let everyDays: number | undefined;
      const builder = {
        timeBased: () => builder,
        onWeekDay: (wd: string) => {
          weekDay = wd;
          return builder;
        },
        everyDays: (days: number) => {
          everyDays = days;
          return builder;
        },
        atHour: (h: number) => {
          hour = h;
          return builder;
        },
        create: () => {
          const entry = { handlerFunction, weekDay, hour, everyDays };
          triggers.push(entry);
          return {
            getHandlerFunction: () => handlerFunction
          };
        }
      };
      return builder;
    })
  };

  const LockService = {
    getScriptLock: () => ({
      waitLock: vi.fn(() => {
        if (lockState.locked) throw new Error("Lock is already held");
        lockState.locked = true;
        lockState.waits++;
      }),
      releaseLock: vi.fn(() => {
        lockState.locked = false;
        lockState.releases++;
      })
    })
  };

  const HtmlService = {
    XFrameOptionsMode: {
      ALLOWALL: "ALLOWALL"
    },
    createTemplateFromFile: vi.fn((fileName: string) => {
      const tpl: Record<string, any> = {
        _fileName: fileName,
        evaluate: () => {
          const out: Record<string, any> = {
            template: tpl,
            title: "",
            xFrameMode: "",
            metaTags: [] as Array<{ name: string; content: string }>,
            setTitle: (t: string) => {
              out.title = t;
              return out;
            },
            setXFrameOptionsMode: (m: string) => {
              out.xFrameMode = m;
              return out;
            },
            addMetaTag: (name: string, content: string) => {
              out.metaTags.push({ name, content });
              return out;
            }
          };
          return out;
        }
      };
      lastCreatedTemplate = tpl;
      return tpl;
    })
  };

  const Logger = {
    log: vi.fn((msg: string) => {
      logs.push(String(msg));
    }),
    getLogs: () => logs
  };

  const CacheService = {
    getScriptCache: () => ({
      put: vi.fn(
        (key: string, value: string, _expirationInSeconds?: number) => {
          cacheStore.set(key, String(value));
        }
      ),
      get: vi.fn((key: string) => cacheStore.get(key) ?? null)
    })
  };

  const Utilities = {
    base64Encode: (bytes: any) => Buffer.from(bytes).toString("base64"),
    formatDate: (date: Date, timeZone: string, format: string) => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }).formatToParts(date);
      const values = Object.fromEntries(
        parts.map((part) => [part.type, part.value])
      );
      if (format === "u") {
        return String(
          { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[
            values.weekday as "Mon"
          ]
        );
      }
      if (format === "yyyy-MM-dd") {
        return `${values.year}-${values.month}-${values.day}`;
      }
      if (format === "yyyy-MM-dd'T'HH:mm:ss") {
        return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
      }
      throw new Error(`Unsupported Utilities.formatDate format: ${format}`);
    },
    parseDate: (value: string, timeZone: string, format: string) => {
      const match =
        /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/.exec(value);
      if (
        !match ||
        (format === "yyyy-MM-dd" && match[4]) ||
        (format === "yyyy-MM-dd'T'HH:mm:ss" && !match[4]) ||
        (format !== "yyyy-MM-dd" && format !== "yyyy-MM-dd'T'HH:mm:ss")
      ) {
        throw new Error(`Unsupported Utilities.parseDate format: ${format}`);
      }
      const [year, month, day, hour = "0", minute = "0", second = "0"] = match
        .slice(1)
        .map((part) => part || "0");
      const localAsUtc = Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second)
      );
      let timestamp = localAsUtc;
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        hourCycle: "h23"
      });
      for (let attempt = 0; attempt < 3; attempt++) {
        const parts = Object.fromEntries(
          formatter
            .formatToParts(new Date(timestamp))
            .map((part) => [part.type, part.value])
        );
        const observedAsUtc = Date.UTC(
          Number(parts.year),
          Number(parts.month) - 1,
          Number(parts.day),
          Number(parts.hour),
          Number(parts.minute),
          Number(parts.second)
        );
        const adjustment = localAsUtc - observedAsUtc;
        timestamp += adjustment;
        if (adjustment === 0) break;
      }
      return new Date(timestamp);
    }
  };

  const MimeType = {
    GOOGLE_DOCS: "application/vnd.google-apps.document"
  };

  const UrlFetchApp = {
    fetch: vi.fn(
      (
        _url: string,
        _opts?: any
      ): { getContentText: () => string; getResponseCode: () => number } => ({
        getContentText: (): string => "<p>Exported Google Doc HTML</p>",
        getResponseCode: (): number => 200
      })
    )
  };

  const ContentService = {
    MimeType: { JSON: "application/json" },
    createTextOutput: vi.fn((content: string) => {
      let mimeType = "text/plain";
      const output = {
        getContent: () => content,
        getMimeType: () => mimeType,
        setMimeType: (value: string) => {
          mimeType = value;
          return output;
        }
      };
      return output;
    })
  };

  const SpreadsheetApp = {
    openById: vi.fn((_id: string): any => ({
      getSheetByName: vi.fn((_name: string): any => ({
        appendRow: vi.fn((row: any[]) => sheetRows.push(row))
      })),
      insertSheet: vi.fn((_name: string): any => ({
        appendRow: vi.fn((row: any[]) => sheetRows.push(row))
      }))
    }))
  };

  const mockEvents = new Map<string, any>();
  const calendarTimeZone = { value: "America/New_York" };
  const attachMockEventId = (id: string, event: any) => {
    if (event && typeof event.getId !== "function") {
      event.getId = () => "ical:" + id;
    }
    return event;
  };
  const CalendarApp = {
    GuestStatus: {
      YES: "YES",
      NO: "NO",
      MAYBE: "MAYBE",
      INVITED: "INVITED"
    },
    getDefaultCalendar: () => ({
      getId: () => "primary",
      getTimeZone: () => calendarTimeZone.value,
      getEventById: (id: string) =>
        attachMockEventId(id, mockEvents.get(id) || null),
      getEvents: vi.fn((startTime: Date, endTime: Date) =>
        Array.from(mockEvents.entries())
          .filter(([, event]) => {
            if (!event || typeof event.getStartTime !== "function") {
              return false;
            }
            const eventStart = event.getStartTime();
            return eventStart >= startTime && eventStart <= endTime;
          })
          .map(([id, event]) => attachMockEventId(id, event))
      )
    })
  };

  const Calendar = {
    Events: {
      list: vi.fn((_calendarId: string, options: Record<string, any>) => ({
        items: Array.from(mockEvents.entries())
          .map(([id, event]) => {
            const attachedEvent = attachMockEventId(id, event);
            return {
              id,
              iCalUID: attachedEvent.getId(),
              start: { dateTime: attachedEvent.getStartTime().toISOString() },
              end: { dateTime: attachedEvent.getEndTime().toISOString() }
            };
          })
          .filter((event) => event.iCalUID === options.iCalUID)
      })),
      patch: vi.fn(
        (
          resource: Record<string, any>,
          _calendarId: string,
          eventId: string,
          _options: Record<string, string>
        ) => {
          const event = mockEvents.get(eventId);
          if (!event) throw new Error("Calendar event not found: " + eventId);
          if (typeof event.setTime === "function") {
            event.setTime(
              new Date(resource.start.dateTime),
              new Date(resource.end.dateTime)
            );
          }
          if (typeof event.setDescription === "function") {
            event.setDescription(resource.description);
          }
          return { id: eventId, ...resource };
        }
      )
    }
  };

  const Tasks = {
    Tasks: {
      list: vi.fn(
        (
          _listId: string,
          _options?: Record<string, unknown>
        ): { items: typeof taskStore; nextPageToken?: string } => ({
          items: [...taskStore]
        })
      ),
      insert: vi.fn((task: any, _listId: string) => {
        const created = {
          id: "task_" + (taskStore.length + 1),
          title: task.title,
          notes: task.notes,
          due: task.due,
          status: "needsAction"
        };
        taskStore.push(created);
        return created;
      })
    }
  };

  // Assign to global
  (globalThis as any).DriveApp = DriveApp;
  (globalThis as any).PropertiesService = PropertiesService;
  (globalThis as any).ScriptApp = ScriptApp;
  (globalThis as any).LockService = LockService;
  (globalThis as any).Session = Session;
  (globalThis as any).HtmlService = HtmlService;
  (globalThis as any).ContentService = ContentService;
  (globalThis as any).Logger = Logger;
  (globalThis as any).CacheService = CacheService;
  (globalThis as any).Utilities = Utilities;
  (globalThis as any).MimeType = MimeType;
  (globalThis as any).UrlFetchApp = UrlFetchApp;
  (globalThis as any).SpreadsheetApp = SpreadsheetApp;
  (globalThis as any).CalendarApp = CalendarApp;
  (globalThis as any).Calendar = Calendar;
  (globalThis as any).Tasks = Tasks;

  return {
    fileStore,
    propsStore,
    cacheStore,
    logs,
    triggers,
    lockState,
    Session,
    setActiveUserEmail: (email: string) => {
      activeUserEmail = email;
    },
    setTemporaryActiveUserKey: (key: string) => {
      activeUserKey = key;
    },
    getLastCreatedTemplate: () => lastCreatedTemplate,
    sheetRows,
    taskStore,
    mockEvents,
    setCalendarTimeZone: (timeZone: string) => {
      calendarTimeZone.value = timeZone;
    },
    DriveApp,
    ScriptApp,
    LockService,
    HtmlService,
    ContentService,
    Logger,
    CacheService,
    UrlFetchApp,
    SpreadsheetApp,
    CalendarApp,
    Calendar,
    Tasks
  };
}
