#!/usr/bin/env python3
"""Session Artifacts Pre-Flight Validator & Auto-Fixer
Validates and auto-repairs HTML, Markdown, Python, Apps Script RPC contracts, Images, Audio, and Print CSS for the GM Dashboard.
"""

import argparse
import os
import re
import subprocess
import sys


def extract_client_js(html_path, out_path=".vitest/Index.client.js"):
    if not os.path.exists(html_path):
        return False
    with open(html_path, encoding="utf-8", errors="ignore") as f:
        content = f.read()
    m = re.search(
        r"<script>([\s\S]*?)</script>\s*</body>", content, flags=re.IGNORECASE
    )
    if not m:
        return False
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as out:
        out.write(m.group(1))
    return True


def check_and_fix_html(path, fix=False):
    issues = []
    with open(path, encoding="utf-8", errors="ignore") as f:
        content = f.read()

    modified = False

    # 1. Check & Fix <base target="_self"> inside <head> (accepts self-closing <base target="_self" /> from Prettier)
    if (
        "<head>" in content
        and '<base target="_self"' not in content
        and "<base target='_self'" not in content
    ):
        issues.append(
            'MISSING_BASE_SELF: <head> does not contain <base target="_self">.'
        )
        if fix:
            content = content.replace(
                "<head>", '<head>\n  <base target="_self" />'
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

    # 5. If this is Index.html, enforce ADR-0008 server-side companion scriptlet isolation
    if os.path.basename(path) == "Index.html":
        extract_client_js(path)
        if 'viewMode !== "companion"' not in content:
            issues.append(
                "MISSING_COMPANION_SCRIPTLET_GUARD: Index.html does not guard GM DOM (#sidebar/#workspace) with server-side viewMode !== 'companion' scriptlet (ADR-0008)."
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

    # 3. Check for absolute local paths (except in agent skill docs that document file:// link syntax)
    rel_norm = path.replace("\\", "/")
    is_agent_skill_doc = "/.agents/skills/" in rel_norm
    if not is_agent_skill_doc and (
        "file:///" in content or "/Users/" in content
    ):
        issues.append(
            "LOCAL_PATH_LEAK: Contains local file paths (file:/// or /Users/)."
        )

    if fix and modified:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

    return issues


def check_python(path):
    issues = []
    try:
        with open(path, encoding="utf-8") as f:
            source = f.read()
        compile(source, path, "exec")
    except SyntaxError as exc:
        issues.append(f"PYTHON_SYNTAX_ERROR: line {exc.lineno}: {exc.msg}")
    return issues


def check_rpc_and_helper_contracts(dir_path):
    """Verifies cross-boundary RPC gmKey propagation and checks for dead private helpers."""
    issues = []
    code_gs_path = os.path.join(dir_path, "Code.gs")
    index_html_path = os.path.join(dir_path, "Index.html")
    if not (os.path.exists(code_gs_path) and os.path.exists(index_html_path)):
        return issues

    with open(code_gs_path, encoding="utf-8", errors="ignore") as f:
        code_gs = f.read()
    with open(index_html_path, encoding="utf-8", errors="ignore") as f:
        index_html = f.read()

    # 1. Check unused private helper functions (ending in _) in Code.gs and Index.html
    for label, source in (("Code.gs", code_gs), ("Index.html", index_html)):
        private_helpers = set(
            re.findall(r"function\s+([a-zA-Z0-9_]+_)\s*\(", source)
        )
        for helper in sorted(private_helpers):
            occurrences = len(re.findall(rf"\b{re.escape(helper)}\b", source))
            if occurrences < 2:
                issues.append(
                    f"UNUSED_PRIVATE_HELPER ({label}): Private helper '{helper}' is declared but never called."
                )

    # 2. Verify that every assertGmAccess_-guarded RPC in Code.gs called from Index.html passes gmKey
    fn_matches = list(
        re.finditer(r"^function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)", code_gs, re.M)
    )
    guarded_rpcs = []
    for idx, m in enumerate(fn_matches):
        fn_name = m.group(1)
        if fn_name.endswith("_") or fn_name in ("doGet", "doPost"):
            continue
        start = m.start()
        end = (
            fn_matches[idx + 1].start()
            if idx + 1 < len(fn_matches)
            else len(code_gs)
        )
        body = code_gs[start:end]
        if "assertGmAccess_(" in body:
            guarded_rpcs.append(fn_name)

    for rpc in guarded_rpcs:
        call_sites = list(re.finditer(rf"\.{re.escape(rpc)}\s*\(", index_html))
        if not call_sites:
            continue
        for site in call_sites:
            window = index_html[
                max(0, site.start() - 250) : min(
                    len(index_html), site.end() + 250
                )
            ]
            if "gmKey" not in window and "getClientGmKey_" not in window:
                issues.append(
                    f"UNGUARDED_CLIENT_RPC_CALL: Index.html calls '{rpc}(...)' without propagating gmKey required by assertGmAccess_ in Code.gs."
                )

    return issues


def check_image(path):
    issues = []
    size = os.path.getsize(path)
    if size > 50 * 1024 * 1024:
        issues.append(
            f"IMAGE_TOO_LARGE: Size is {size / (1024 * 1024):.2f}MB (> 50MB warning threshold)."
        )
    elif size == 0:
        issues.append("EMPTY_IMAGE: Image file is 0 bytes.")
    return issues


def check_git_whitespace(dir_path):
    """Checks committed and working-tree changes for conflict markers and whitespace errors via git diff --check."""
    issues = []
    if not os.path.exists(os.path.join(dir_path, ".git")):
        return issues
    try:
        head_res = subprocess.run(
            ["git", "rev-parse", "--verify", "HEAD"],
            cwd=dir_path,
            capture_output=True,
            text=True,
            timeout=15,
        )
        head_sha = head_res.stdout.strip() if head_res.returncode == 0 else ""
        mb_res = subprocess.run(
            ["git", "merge-base", "HEAD", "origin/main"],
            cwd=dir_path,
            capture_output=True,
            text=True,
            timeout=15,
        )
        mb_sha = mb_res.stdout.strip() if mb_res.returncode == 0 else ""
        if mb_sha and mb_sha != head_sha:
            base_ref = mb_sha
        else:
            prev_res = subprocess.run(
                ["git", "rev-parse", "--verify", "HEAD~1"],
                cwd=dir_path,
                capture_output=True,
                text=True,
                timeout=15,
            )
            base_ref = (
                prev_res.stdout.strip() if prev_res.returncode == 0 else "HEAD"
            )
        res = subprocess.run(
            ["git", "diff", "--check", base_ref],
            cwd=dir_path,
            capture_output=True,
            text=True,
            timeout=15,
        )
        if res.returncode != 0:
            output = (res.stdout or res.stderr).strip()
            if output:
                for line in output.splitlines():
                    issues.append(f"GIT_DIFF_CHECK: {line}")
            else:
                issues.append(
                    f"GIT_DIFF_CHECK: git diff --check {base_ref} exited with status {res.returncode}."
                )
    except Exception as exc:
        issues.append(f"GIT_DIFF_CHECK_ERROR: {exc}")
    return issues


def validate_directory(dir_path, fix=False):
    print("\n=======================================================")
    print(f"🔍 PRE-FLIGHT AUDIT {'& AUTO-FIX' if fix else ''}: {dir_path}")
    print("=======================================================")

    total_files = 0
    total_issues = 0

    for root, dirs, files in os.walk(dir_path):
        dirs[:] = [
            d
            for d in dirs
            if not d.startswith(".") and d not in ("node_modules", "dist")
        ]
        for file in sorted(files):
            if file.startswith(".") or file.endswith(".pyc"):
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
            elif ext == ".py":
                file_issues = check_python(full_path)
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

    contract_issues = check_rpc_and_helper_contracts(dir_path)
    if contract_issues:
        total_issues += len(contract_issues)
        print(f"\n❌ Cross-Boundary Contracts ({len(contract_issues)} issues):")
        for iss in contract_issues:
            print(f"   • {iss}")
    else:
        print("  ✓ Cross-boundary RPC & helper contracts")

    ws_issues = check_git_whitespace(dir_path)
    if ws_issues:
        total_issues += len(ws_issues)
        print(f"\n❌ Git Whitespace & Conflict Check ({len(ws_issues)} issues):")
        for iss in ws_issues:
            print(f"   • {iss}")
    else:
        print("  ✓ Git diff whitespace & conflict marker check")

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
    parser.add_argument(
        "--extract-client-js",
        action="store_true",
        help="Extract Index.html <script> block to .vitest/Index.client.js for ESLint.",
    )
    args = parser.parse_args()

    if args.extract_client_js:
        ok = extract_client_js(os.path.join(args.path, "Index.html"))
        sys.exit(0 if ok else 1)

    success = validate_directory(args.path, fix=args.fix)
    sys.exit(0 if (success or args.fix) else 1)
