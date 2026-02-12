import os
import subprocess
import re

def resolve_naming_conflicts():
    # Get list of conflicted files
    result = subprocess.run(['git', 'status', '--porcelain'], capture_output=True, text=True)
    conflicted_files = []
    for line in result.stdout.splitlines():
        if line.startswith('UU '):
            conflicted_files.append(line[3:])

    print(f"Checking {len(conflicted_files)} files for naming conflicts...")

    branding_terms = ['openclaw', 'moltbot', 'clawdbot', 'claw']
    resolved_count = 0

    for file_path in conflicted_files:
        if not os.path.exists(file_path):
            continue
            
        with open(file_path, 'r') as f:
            lines = f.readlines()

        new_lines = []
        i = 0
        file_resolved = False
        while i < len(lines):
            line = lines[i]
                # Start of conflict
                head_block = []
                i += 1
                    upstream_block.append(lines[i])
                    i += 1
                
                tail_marker = lines[i] if i < len(lines) else ""
                
                # Check if this is a naming conflict (e.g. HEAD has Verso, upstream has Verso)
                head_text = "".join(head_block).lower()
                upstream_text = "".join(upstream_block).lower()
                
                is_naming_conflict = False
                if 'verso' in head_text:
                    for term in branding_terms:
                        if term in upstream_text:
                            is_naming_conflict = True
                            break
                
                # If they are identical after normalization (ignoring branding)
                # For now, let's just pick HEAD if HEAD has Verso and upstream has old branding
                if is_naming_conflict and len(head_block) == len(upstream_block):
                   # Tentative: assume they are functionally identical but with different names
                   new_lines.extend(head_block)
                   file_resolved = True
                else:
                    # Keep markers for complex ones
                    new_lines.append(line)
                    new_lines.extend(head_block)
                    new_lines.append(mid_marker)
                    new_lines.extend(upstream_block)
                    new_lines.append(tail_marker)
            else:
                new_lines.append(line)
            i += 1
        
        if file_resolved:
            with open(file_path, 'w') as f:
                f.writelines(new_lines)
            subprocess.run(['git', 'add', file_path])
            resolved_count += 1

    print(f"Resolved naming conflicts in {resolved_count} files.")

if __name__ == "__main__":
    resolve_naming_conflicts()
