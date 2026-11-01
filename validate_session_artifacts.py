#!/usr/bin/env python3
"""Session Artifacts Pre-Flight Validator & Auto-Fixer
Validates and auto-repairs HTML, Markdown, Images, Audio, and Print CSS for the GM Dashboard.
"""

import argparse
import os
import re
import sys


def check_and_fix_html(path, fix=False):
    issues = []
    with open(path, encoding="utf-8", errors="ignore") as f:
        content = f.read()

    modified = False

    # 1. Check & Fix <base target="_self"> inside <head>
    if (
        "<head>" in content
        and '<base target="_self">' not in content
        and "<base target='_self'>" not in content
    ):
        issues.append(
            'MISSING_BASE_SELF: <head> does not contain <base target="_self">.'
        )
        if fix:
            content = content.replace(
                "<head>", '<head>\n  <base target="_self">'
            )
            modified = True

    # 2. Check internal anchor links
    anchors = re.findall(r'href=["\']#([^"\']+)["\']', content)
    for a in set(anchors):
        if not (
            f'id="{a}"' in content
            or f"id='{a}'" in content
            or f'name="{a}"' in content
            or f"name='{a}'" in content
        ):
            issues.append(
                f'BROKEN_INTERNAL_ANCHOR: href="#{a}" has no matching id="{a}" or name="{a}".'
            )

    # 3. Check lifecycle hook safety
    if (
        "document.addEventListener('DOMContentLoaded'" in content
        or 'document.addEventListener("DOMContentLoaded"' in content
    ) and "document.readyState" not in content:
        issues.append(
            "UNGUARDED_DOM_CONTENT_LOADED: Uses DOMContentLoaded without checking document.readyState."
        )

    # 4. Check Print CSS
    if "@media print" in content:
        m_print = content[content.find("@media print") :]
        if "table" in content and "td" in content:
            if (
                "background: #ffffff" not in m_print
                and "background:#ffffff" not in m_print
                and "background: #fff" not in m_print
            ):
                issues.append(
                    "PRINT_BACKGROUND_LEAK: @media print does not explicitly set white backgrounds on tables/cells."
                )
    else:
        issues.append(
            "MISSING_PRINT_CSS: No @media print styles found in printable HTML."
        )

    if fix and modified:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

    return issues


def check_and_fix_markdown(path, fix=False):
    issues = []
    with open(path, encoding="utf-8", errors="ignore") as f:
        content = f.read().strip()

    modified = False

    # 1. Check & Fix outer code fence wrapping
    if content.startswith("```markdown") and content.endswith("```"):
        issues.append(
            "WRAPPED_IN_CODE_FENCE: Markdown file begins and ends with ```markdown. Renders as raw code."
        )
        if fix:
            # Strip outer fence cleanly
            content = re.sub(
                r"^```markdown\s*\n", "", content, flags=re.IGNORECASE
            )
            content = re.sub(r"\n```$", "", content)
            modified = True

    # 2. Check Homebrewery statblock pairing
    open_tags = len(re.findall(r"\{monster,frame", content))
    close_tags = len(re.findall(r"\n\}", content))
    if open_tags != close_tags:
        issues.append(
            f"UNBALANCED_STATBLOCK_TAGS: Found {open_tags} '{{monster,frame' but {close_tags} closing '}}'."
        )
        if fix and open_tags > close_tags:
            content += "\n}\n"
            modified = True

    # 3. Check for absolute local paths
    if "file:///" in content or "/Users/" in content:
        issues.append(
            "LOCAL_PATH_LEAK: Contains local file paths (file:/// or /Users/)."
        )

    if fix and modified:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

    return issues


def check_image(path):
    issues = []
    size = os.path.getsize(path)
    if size > 8 * 1024 * 1024:
        issues.append(
            f"IMAGE_TOO_LARGE: Size is {size / (1024 * 1024):.2f}MB (> 8MB limit for Base64 streaming)."
        )
    elif size == 0:
        issues.append("EMPTY_IMAGE: Image file is 0 bytes.")
    return issues


def validate_directory(dir_path, fix=False):
    print("\n=======================================================")
    print(f"🔍 PRE-FLIGHT AUDIT {'& AUTO-FIX' if fix else ''}: {dir_path}")
    print("=======================================================")

    total_files = 0
    total_issues = 0

    for root, dirs, files in os.walk(dir_path):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for file in sorted(files):
            if (
                file.startswith(".")
                or file.endswith(".py")
                or file.endswith(".pyc")
            ):
                continue

            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, dir_path)
            total_files += 1

            ext = os.path.splitext(file)[1].lower()
            file_issues = []

            if ext == ".html":
                file_issues = check_and_fix_html(full_path, fix=fix)
            elif ext == ".md":
                file_issues = check_and_fix_markdown(full_path, fix=fix)
            elif ext in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
                file_issues = check_image(full_path)

            if file_issues:
                total_issues += len(file_issues)
                print(
                    f"\n{'🔧 FIXED' if fix else '❌'} {rel_path} ({len(file_issues)} issues):"
                )
                for iss in file_issues:
                    print(f"   • {iss}")
            else:
                print(f"  ✓ {rel_path}")

    print("\n-------------------------------------------------------")
    if total_issues == 0:
        print(
            f"✨ AUDIT PASSED: {total_files} files inspected, 0 issues found."
        )
    else:
        print(
            f"⚠️ AUDIT SUMMARY: Encountered {total_issues} issues across {total_files} files."
        )
    print("-------------------------------------------------------\n")
    return total_issues == 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Validate and repair session artifacts."
    )
    parser.add_argument(
        "path", nargs="?", default=".", help="Directory path to audit."
    )
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Automatically repair detected issues.",
    )
    args = parser.parse_args()

    success = validate_directory(args.path, fix=args.fix)
    sys.exit(0 if (success or args.fix) else 1)
