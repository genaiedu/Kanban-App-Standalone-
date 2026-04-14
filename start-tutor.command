#!/bin/bash

# Wechsel ins Verzeichnis der HTML-Dateien
cd "$(dirname "$0")" || exit

echo "🎓 EDUBAN Tutor-Server wird gestartet..."
echo ""

# Frage nach Browser-Auswahl
echo "Welcher Browser soll verwendet werden?"
echo "1) Chrome"
echo "2) Safari"
echo "3) Firefox"
echo "4) Edge"
echo "5) Kein Browser öffnen (nur Server)"
echo ""
read -p "Bitte wähle eine Option (1-5): " browser_choice

# Server im Hintergrund starten
python3 -m http.server 8000 > /dev/null 2>&1 &
SERVER_PID=$!

# Kurz warten, bis Server läuft
sleep 2

echo ""
echo "✅ Server läuft auf Port 8000"
echo "📍 URL: http://localhost:8000/tutor-T4xWqN8k.html"
echo ""

# Browser öffnen basierend auf Auswahl
case $browser_choice in
  1)
    echo "🌐 Öffne Chrome..."
    open -a "Google Chrome" "http://localhost:8000/tutor-T4xWqN8k.html"
    ;;
  2)
    echo "🌐 Öffne Safari..."
    open -a "Safari" "http://localhost:8000/tutor-T4xWqN8k.html"
    ;;
  3)
    echo "🌐 Öffne Firefox..."
    open -a "Firefox" "http://localhost:8000/tutor-T4xWqN8k.html"
    ;;
  4)
    echo "🌐 Öffne Microsoft Edge..."
    open -a "Microsoft Edge" "http://localhost:8000/tutor-T4xWqN8k.html"
    ;;
  5)
    echo "📭 Browser wird nicht geöffnet"
    echo "🔗 Öffne manuell: http://localhost:8000/tutor-T4xWqN8k.html"
    ;;
  *)
    echo "⚠️  Ungültige Auswahl"
    ;;
esac

echo ""
echo "⏹️  Server läuft. Zum Beenden: Ctrl+C drücken"
echo ""

# Server laufen lassen
wait $SERVER_PID
