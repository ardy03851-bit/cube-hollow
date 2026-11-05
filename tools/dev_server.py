import http.server, os, sys

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()
    def log_message(self, *a):
        pass

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)) + '/..')
    http.server.HTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8322), NoCacheHandler).serve_forever()
