"""Private worker HTTPS transport. Never log credentials or provider response bodies."""
import json, os, urllib.request, urllib.error

PROJECT = 'https://kiauwgvmbewdwedadqxv.supabase.co'
class HostedError(Exception):
    def __init__(self, status=None):
        self.status = status
        super().__init__('Hosted request failed' + (f' (HTTP {status})' if status else ''))

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None

class API:
    def __init__(self):
        self.key = os.environ.get('DAYBREAK_SUPABASE_WORKER_KEY')
        if not self.key: raise HostedError()
        self.opener = urllib.request.build_opener(NoRedirect)

    def call(self, path, method='GET', body=None, raw=False, mime='application/json'):
        if not path.startswith(('/rest/v1/', '/storage/v1/')) or '..' in path or '\\' in path:
            raise HostedError()
        payload = body if isinstance(body, bytes) else json.dumps(body).encode() if body is not None else None
        headers = {'apikey': self.key, 'Authorization': 'Bearer '+self.key,
                   'Content-Type': mime, 'Prefer': 'return=representation'}
        try:
            request = urllib.request.Request(PROJECT+path, data=payload, headers=headers, method=method)
            with self.opener.open(request, timeout=30) as response:
                content = response.read(40*1024*1024+1)
                if len(content)>40*1024*1024: raise HostedError()
                return content if raw else json.loads(content) if content else None
        except urllib.error.HTTPError as e:
            status=e.code;e.close();raise HostedError(status) from None
        except HostedError: raise
        except Exception: raise HostedError() from None
