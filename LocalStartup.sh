#!/bin/bash
cd "$(dirname "$0")"
PORT=8080
lsof -ti :$PORT | xargs kill -9 2>/dev/null && echo "stopped" || echo "nothing on $PORT"
echo "Starting Greek Verb Trainer at http://localhost:$PORT"
echo "Press Ctrl+C to stop."
open "http://localhost:$PORT"
python3 -m http.server $PORT
