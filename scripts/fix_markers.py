import os

def print_usage(manager=None):
    help_text = """
Usage: python ghost_manager.py <module> <command> [args...]

Modules: posts, pages, tags, authors, members, newsletters, settings, images, media, themes, webhooks, site

Commands:
  browse [json_params]          List records (e.g. browse '{"filter":"tag:news"}')
  read <id_or_slug> [json]      Get single record
  add <json_data>               Create new record
  edit <id> <json_data>         Update record
  delete <id>                   Remove record
  upload <file_path> [params]   For images, media, themes
  activate <name>               For themes
  test                          Verify credentials and site info
  publish <title> <content>     Shortcut for posts add. <content> can be 
                                HTML string or path (use @prefix like @file.html)
    """
    print(help_text)

def resolve_all_markers_and_branding():
    resolved_files = 0
    branding_terms = ['openclaw', 'moltbot', 'clawdbot', 'claw']
    
    for root, dirs, files in os.walk('.'):
        if any(d in root for d in ['.git', 'node_modules', 'dist', '.venv']):
            continue
        
        for file in files:
            if file.endswith(('.ts', '.js', '.mjs', '.md', '.json', '.html', '.css', '.py', '.kt', '.swift', '.yml', '.yaml')):
                file_path = os.path.join(root, file)
                try:
                    with open(file_path, 'r') as f:
                        lines = f.readlines()
                    
                        # No markers, but maybe old branding?
                        # Actually let's just focus on markers first.
                        continue
                    
                    new_lines = []
                    i = 0
                    file_changed = False
                    while i < len(lines):
                        line = lines[i]
                        if '<<<<<<<' in line:
                            file_changed = True
                            # Start of conflict
                            # Sometimes it might not be HEAD if it's a rebase.
                            # We'll assume the top part is ALWAYS what we want (ours/Verso)
                            head_block = []
                            i += 1
                                i += 1
                            
                            i += 1 # Skip tail
                            new_lines.extend(head_block)
                        else:
                            new_lines.append(line)
                            i += 1
                    
                    if file_changed:
                        with open(file_path, 'w') as f:
                            f.writelines(new_lines)
                        resolved_files += 1
                except:
                    continue
    print(f"Resolved markers in {resolved_files} files.")

if __name__ == "__main__":
    import sys
    # This script is multipurpose now.
    resolve_all_markers_and_branding()
