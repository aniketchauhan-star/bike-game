#!/bin/bash
# Double-click to start UTTARAKHAND RIDERS (Mac)
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js nahi mila. Pehle install karo: https://nodejs.org"
  read -p "Enter dabao..."
  exit 1
fi
(sleep 1.5; open "http://localhost:8080/") &
node server.js
