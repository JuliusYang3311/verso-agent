import os
import sys
import json
import requests
import jwt
from datetime import datetime, timedelta

# Default to v6.17
DEFAULT_GHOST_VERSION = 'v6.17'

class GhostManager:
    def __init__(self, api_url, content_key=None, admin_key=None, version=DEFAULT_GHOST_VERSION):
        self.api_url = api_url.rstrip('/')
        self.content_key = content_key
        self.admin_key = admin_key
        self.version = version

    def _get_admin_token(self):
        if not self.admin_key:
            return None
        try:
            id, secret = self.admin_key.split(':')
        except ValueError:
            return None

        # Use a slightly older iat to account for server clock skew
        iat = int(datetime.now().timestamp()) - 30
        header = {'alg': 'HS256', 'typ': 'JWT', 'kid': id}
        payload = {
            'iat': iat,
            'exp': iat + 5 * 60,
            'aud': '/admin/'
        }
        # print(f"Generating JWT for aud: {payload['aud']} with iat: {iat}")
        return jwt.encode(payload, bytes.fromhex(secret), algorithm='HS256', headers=header)

    def _get_headers(self, is_admin=True):
        headers = {'Accept-Version': self.version}
        if is_admin:
            token = self._get_admin_token()
            if not token:
                raise ValueError("Missing or invalid Admin API Key")
            headers['Authorization'] = f'Ghost {token}'
            headers['Content-Type'] = 'application/json'
        return headers

    def _api_request(self, method, endpoint, params=None, json_data=None, is_admin=True):
        prefix = 'admin' if is_admin else 'content'
        # Special case for content API: needs key in params
        actual_params = dict(params) if params else {}
        if not is_admin:
            actual_params['key'] = self.content_key

        url = f"{self.api_url}/ghost/api/{prefix}/{endpoint.strip('/')}/"
        headers = self._get_headers(is_admin)
        
        try:
            res = requests.request(method, url, headers=headers, params=actual_params, json=json_data)
            if res.status_code == 204:
                return True
            res.raise_for_status()
            return res.json()
        except requests.exceptions.RequestException as e:
            print(f"API Request Error ({method} {endpoint}): {e}")
            if hasattr(e.response, 'text'):
                print(f"Server response: {e.response.text}")
            return None

    # --- Generic Entity CRUD (Admin/Content) ---
    def browse(self, entity, is_admin=True, **kwargs):
        """ List records for an entity. """
        return self._api_request('GET', entity, params=kwargs, is_admin=is_admin)

    def read(self, entity, id_or_slug, is_admin=True, is_slug=False, **kwargs):
        """ Get a single record by ID or Slug. """
        endpoint = f"{entity}/slug/{id_or_slug}" if is_slug else f"{entity}/{id_or_slug}"
        return self._api_request('GET', endpoint, params=kwargs, is_admin=is_admin)

    def add(self, entity, data):
        """ Create a new record. data is a dict representing the entity object. """
        # Ghost API wraps the object in an array under the entity key
        payload = {entity: [data]}
        # Support for source=html for Posts/Pages
        params = {}
        if (entity == "posts" or entity == "pages") and 'html' in data:
            params['source'] = 'html'
        
        return self._api_request('POST', entity, params=params, json_data=payload)

    def edit(self, entity, id, data):
        """ Update an existing record. Handles updated_at requirement. """
        if 'updated_at' not in data:
            current = self.read(entity, id)
            if current and entity in current:
                data['updated_at'] = current[entity][0]['updated_at']
            else:
                raise ValueError(f"Could not retrieve updated_at for {entity} {id}")
        
        return self._api_request('PUT', f"{entity}/{id}", json_data={entity: [data]})

    def delete(self, entity, id):
        """ Delete a record. """
        return self._api_request('DELETE', f"{entity}/{id}")

    # --- Uploads (Images, Media, Themes) ---
    def upload(self, resource_type, file_path, **kwargs):
        """ Generic upload for images, media, or themes. """
        # resource_type should be 'images', 'media', or 'themes'
        endpoint = f"{resource_type}/upload/"
        url = f"{self.api_url}/ghost/api/admin/{endpoint}"
        headers = self._get_headers(is_admin=True)
        headers.pop('Content-Type', None) # requests will set multipart boundary
        
        filename = os.path.basename(file_path)
        with open(file_path, 'rb') as f:
            files = {'file': (filename, f)}
            # data fields (like 'purpose', 'ref', 'name')
            try:
                res = requests.post(url, headers=headers, files=files, data=kwargs)
                res.raise_for_status()
                return res.json()
            except requests.exceptions.RequestException as e:
                print(f"Upload Error ({resource_type}): {e}")
                if hasattr(e.response, 'text'):
                    print(f"Server response: {e.response.text}")
                return None

    # --- Specialized Actions ---
    def activate_theme(self, theme_name):
        """ Switch the active theme. """
        return self._api_request('PUT', f"themes/{theme_name}/activate")

    def edit_settings(self, settings_list):
        """ Update site settings. settings_list is a list of {'key': '...', 'value': '...'} """
        return self._api_request('PUT', 'settings', json_data={'settings': settings_list})

# --- CLI Implementation ---
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

def main():
    api_url = os.environ.get("GHOST_API_URL")
    content_key = os.environ.get("GHOST_CONTENT_API_KEY")
    admin_key = os.environ.get("GHOST_ADMIN_API_KEY")
    
    if not api_url:
        print("Error: GHOST_API_URL required.")
        sys.exit(1)

    manager = GhostManager(api_url, content_key, admin_key)

    if len(sys.argv) < 2:
        print_usage(manager)
        sys.exit(1)

    module = sys.argv[1]
    # Default to browse or test if secondary command missing
    cmd = sys.argv[2] if len(sys.argv) > 2 else ("test" if module == "test" else "browse")

    try:
        # 1. Handle 'test'
        if module == "test" or cmd == "test":
            print("Verifying Ghost configuration...")
            print(f"API URL: {manager.api_url}")
            print(f"Version: {manager.version}")
            
            # Test Content API
            if manager.content_key:
                print("Testing Content API key...")
                site_info = manager.read("site", "", is_admin=False)
                site_title = site_info.get('site', {}).get('title', 'Unknown') if site_info else 'Unknown'
                if site_info and 'site' in site_info:
                    print(f"Content API Success! Site Title: {site_title}")
                else:
                    print("Content API Failed to retrieve site info.")
            
            # Test Admin API
            if manager.admin_key:
                print("Testing Admin API key...")
                try:
                    settings = manager.read("settings", "", is_admin=True)
                    if settings and 'settings' in settings:
                        print("Admin API Success! Authenticated and retrieved settings.")
                    else:
                        print("Admin API Failed (Check credentials).")
                except Exception as e:
                    print(f"Admin API Error: {e}")
            return

        # 2. Check argument count for remaining commands
        if len(sys.argv) < 3:
            print_usage(manager)
            sys.exit(1)

        # 3. Handle specific modules/commands
        if module == "site" and cmd == "read":
            print(json.dumps(manager.read("site", "", is_admin=False), indent=2))
            return

        if cmd == "browse":
            params = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
            # Content API access for certain modules if keys provided
            is_admin = not (module in ["posts", "tags", "authors", "pages", "tiers"] and content_key and not admin_key)
            print(json.dumps(manager.browse(module, is_admin=is_admin, **params), indent=2))
        
        elif cmd == "read":
            id_val = sys.argv[3]
            params = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}
            is_slug = not id_val.startswith('6') # Simple heuristic for ID vs Slug in Ghost
            print(json.dumps(manager.read(module, id_val, is_slug=is_slug, **params), indent=2))
            
        elif cmd == "add":
            data = json.loads(sys.argv[3])
            print(json.dumps(manager.add(module, data), indent=2))
            
        elif cmd == "publish" and module == "posts":
            if len(sys.argv) < 4:
                print("Usage: posts publish <title> <html_content_or_@file> [status]")
                print("   or: posts publish --html <@file|html> --title <title> [--tags <comma-separated>] [--status <status>]")
                return

            # Flag-based parsing support
            args = sys.argv[3:]
            if args and args[0].startswith('--'):
                flags = {}
                i = 0
                while i < len(args):
                    if args[i].startswith('--') and i + 1 < len(args):
                        flags[args[i]] = args[i + 1]
                        i += 2
                    else:
                        i += 1

                title = flags.get('--title')
                content = flags.get('--html')
                status = flags.get('--status', 'published')
                tags_str = flags.get('--tags')
                tags = None
                if tags_str:
                    tags = [{"name": t.strip()} for t in tags_str.split(',') if t.strip()]
            else:
                title = sys.argv[3]
                content = sys.argv[4]
                status = sys.argv[5] if len(sys.argv) > 5 else "published"
                tags = None

            if not title or not content:
                print("Error: publish requires --title and --html (or positional title and content)")
                return

            # Support reading from file via @prefix
            if content and content[0] == '@':
                file_path = content[1:]
                try:
                    with open(file_path, 'r') as f:
                        content = f.read()
                except Exception as e:
                    print(f"Error reading file {file_path}: {e}")
                    sys.exit(1)

            post_data = {"title": title, "html": content, "status": status}
            if tags:
                post_data["tags"] = tags
            print(json.dumps(manager.add("posts", post_data), indent=2))
            
        elif cmd == "edit":
            if module == "settings":
                data = json.loads(sys.argv[3]) # expecting list of settings
                print(json.dumps(manager.edit_settings(data), indent=2))
            else:
                data = json.loads(sys.argv[4])
                print(json.dumps(manager.edit(module, sys.argv[3], data), indent=2))
                
        elif cmd == "delete":
            if manager.delete(module, sys.argv[3]):
                print(f"Successfully deleted {module} {sys.argv[3]}")
                
        elif cmd == "upload":
            params = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}
            print(json.dumps(manager.upload(module, sys.argv[3], **params), indent=2))
            
        elif cmd == "activate" and module == "themes":
            print(json.dumps(manager.activate_theme(sys.argv[3]), indent=2))
            
        else:
            print(f"Unknown command {cmd} for module {module}")
            
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
