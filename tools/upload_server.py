import http.server, base64, os
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get('content-length', 0))
        data = self.rfile.read(n)
        if self.path == '/shot':
            with open('/home/user/workspace/shots/shot.jpg', 'wb') as f:
                f.write(base64.b64decode(data))
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers(); self.wfile.write(b'ok')
        else:
            self.send_response(404); self.end_headers()
    def log_message(self, *a): pass
os.makedirs('/home/user/workspace/shots', exist_ok=True)
http.server.HTTPServer(('127.0.0.1', 8324), H).serve_forever()
