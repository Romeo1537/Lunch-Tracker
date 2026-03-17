import http.server, socketserver, os, sys
os.chdir(os.path.dirname(os.path.abspath(__file__)))
handler = http.server.SimpleHTTPRequestHandler
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
with socketserver.TCPServer(("", port), handler) as httpd:
    print(f"Serving on http://localhost:{port}")
    httpd.serve_forever()
