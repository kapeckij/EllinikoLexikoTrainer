#!/bin/bash
cd "$(dirname "$0")/../.."
PORT=8080
echo "Starting Greek Verb Trainer at http://localhost:$PORT"
echo "Press Ctrl+C to stop."
open "http://localhost:$PORT/pages/verbs/index.html"
python3 -m http.server $PORT
