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
  const sheetRows: any[][] = [];
  const taskStore: Array<{
    id: string;
    title: string;
    notes?: string;
    due?: string;
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
      setProperty: (key: string, val: string) => propsStore.set(key, val)
    })
  };

  const ScriptApp = {
    getOAuthToken: () => "mock_oauth_token"
  };

  const Utilities = {
    base64Encode: (bytes: any) => Buffer.from(bytes).toString("base64")
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

  const SpreadsheetApp = {
    openById: vi.fn((_id: string) => ({
      getSheetByName: vi.fn((_name: string) => ({
        appendRow: vi.fn((row: any[]) => sheetRows.push(row))
      })),
      insertSheet: vi.fn((_name: string) => ({
        appendRow: vi.fn((row: any[]) => sheetRows.push(row))
      }))
    }))
  };

  const mockEvents = new Map<string, any>();
  const CalendarApp = {
    GuestStatus: {
      YES: "YES",
      NO: "NO",
      MAYBE: "MAYBE",
      INVITED: "INVITED"
    },
    getDefaultCalendar: () => ({
      getEventById: (id: string) => mockEvents.get(id) || null
    })
  };

  const Tasks = {
    Tasks: {
      list: vi.fn((_listId: string) => ({ items: [...taskStore] })),
      insert: vi.fn((task: any, _listId: string) => {
        const created = {
          id: "task_" + (taskStore.length + 1),
          title: task.title,
          notes: task.notes,
          due: task.due
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
  (globalThis as any).Utilities = Utilities;
  (globalThis as any).MimeType = MimeType;
  (globalThis as any).UrlFetchApp = UrlFetchApp;
  (globalThis as any).SpreadsheetApp = SpreadsheetApp;
  (globalThis as any).CalendarApp = CalendarApp;
  (globalThis as any).Tasks = Tasks;

  return {
    fileStore,
    propsStore,
    sheetRows,
    taskStore,
    mockEvents,
    DriveApp,
    UrlFetchApp,
    SpreadsheetApp,
    CalendarApp,
    Tasks
  };
}
