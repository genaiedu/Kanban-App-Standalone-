#!/bin/bash
# KanbanFluss als Schüler starten — Doppelklick genügt!
cd "$(dirname "$0")"
PORT=8080

# Alten Server auf diesem Port beenden (egal aus welchem Verzeichnis)
OLD_PID=$(lsof -ti tcp:$PORT 2>/dev/null)
if [ -n "$OLD_PID" ]; then
  echo "Beende alten Server (PID $OLD_PID) auf Port $PORT..."
  kill $OLD_PID 2>/dev/null
  sleep 0.5
fi

echo "Starte lokalen Webserver auf Port $PORT aus: $(pwd)"
python3 -m http.server $PORT &>/dev/null &
sleep 1

URL="http://localhost:$PORT/index.html"
echo "Öffne KanbanFluss (Schüler-Version) im Browser..."

# Chrome bevorzugen (unterstützt Speichern-Dialog beim Export)
if open -a "Google Chrome" "$URL" 2>/dev/null; then
  echo "Geöffnet in Google Chrome."
else
  open "$URL"
  echo "Geöffnet im Standard-Browser."
fi

echo ""
echo "KanbanFluss (Schüler-Version) läuft auf $URL"
echo "Dieses Fenster kann offen bleiben (Server läuft im Hintergrund)."
echo "Zum Beenden: Strg+C"
wait
