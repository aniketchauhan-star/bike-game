# 🏍️ UTTARAKHAND RIDERS — Ramnagar → Ranikhet

Ek 3D superbike racing game jo browser me chalta hai (phone aur computer dono par).
Riders: **Mayank** (Kawasaki Ninja ZX-10R), **Tushar** (BMW S 1000 RR), **Himanshu** (Ducati Panigale V4).

Track: Ramnagar bus stand se shuru → Corbett Tiger Reserve ka jungle → Kosi nadi aur Garjiya Devi mandir → pahadi hairpin bends (Mohan, Kumaoni gaon, dhabe) → Ranikhet finish.

---

## ▶️ Game kaise chalaye

**Zaroori:** computer par [Node.js](https://nodejs.org) install hona chahiye (LTS version, ek baar ka kaam).

- **Mac:** `start-game.command` par double-click karo. (Pehli baar macOS poochhe to: right-click → Open.)
- **Windows:** `start-game.bat` par double-click karo.
- **Ya Terminal se:** is folder me jaakar `node server.js` chalao.

Game browser me khul jayega: `http://localhost:8080`

### 📱 Phone par khelna
1. Phone aur computer **ek hi Wi-Fi** par hon.
2. Terminal me jo link dikhe (jaise `http://192.168.1.13:8080`) wo phone ke browser (Chrome) me kholo.
3. **START** dabao. Game apne aap fullscreen ho jayega aur phone ko landscape (aada) kar lo.
- **iPhone:** Safari me fullscreen ka option nahi hota. Share → **"Add to Home Screen"** karo, phir wahan se kholo, tab fullscreen chalega.

### 🎤 Voice chat (khelte-khelte doston se baat)
- Terminal me 🎤 ke saath ek **https://** link dikhta hai (jaise `https://192.168.1.13:8443`). **Voice chat ke liye sab log yahi link kholein.** Phone mic sirf https par deta hai.
- Pehli baar browser "Not private / Not secure" warning dikhayega. Ye aapke apne computer ka certificate hai, isliye **Advanced → Proceed** dabao.
- Room me aur race ke dauraan **🎤 MIC** button se apna mic ON/OFF, **🔊 SPEAKER** se doston ki awaaz ON/OFF. Jo bol raha ho uska naam race me upar-right dikhta hai.
- Earphones lagao, warna phone ka speaker (engine, gaane) mic me wapas chala jayega.

### 👥 Multiplayer (doston ke saath, apne-apne phone se)
1. Ek dost **MULTIPLAYER → CREATE ROOM** dabaye. 4-letter code aur QR code aayega.
2. Baaki dost **JOIN** me code daalein, ya QR scan karein.
3. Har koi apna rider chune (Mayank / Tushar / Himanshu). Khaali jagah par CPU rider bhi daal sakte ho.
4. Host **START RACE** dabaye. Sabki race ek saath shuru hogi.

**Alag-alag jagah ke dost (internet se):**
- Aasaan tareeka: [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) install karo, game chalao, phir doosre Terminal me `cloudflared tunnel --url http://localhost:8080` chalao. Jo `https://....trycloudflare.com` link mile wo doston ko bhej do.
- Ya poora folder kisi static hosting (Netlify Drop / GitHub Pages) par daal do. Server na milne par game apne aap **P2P mode** use karta hai (internet chahiye).

---

## 🎮 Controls

| Kaam | Keyboard | Phone |
|---|---|---|
| Gas | W / ↑ | GAS |
| Brake | S / ↓ / Space | BRAKE |
| Steer | A D / ← → | ◀ ▶ (ya Tilt / Joystick) |
| **Drift** | mod par steer karte hue brake | steer + BRAKE tap |
| **Wheelie** (5 sec) | X / Shift | WHEELIE |
| **Nitro** | N (dabaye rakho) | 🔥 NITRO button (ek tap = poora tank) |
| **Laat maaro** | Q (left) / E (right) | 🦵◀ / ▶🦵 |
| Dialogue | T | 💬 |
| Horn | H | 📣 |
| Camera (Chase / Far / Helmet) | C | 🎥 |
| Reset (track par wapas) | R | ↺ |
| Pause | Esc / P | ❚❚ |

- **Wheelie** button ek baar dabao to 5 second wheelie. Race shuru hote hi sab riders 2 second ka launch wheelie maarte hain.
- **Nitro** drift, wheelie, jump aur takedown se bharta hai. Button ke ring me dikhta hai kitna bhara hai; poora bharne par chamakta hai.
- **TAKEDOWN:** bagal wale rider ko laat maar ke giraoge to slow-motion me camera usko girte dikhata hai, aapka character dialogue bolta hai, aur nitro milta hai. Aapko koi giraye to "LAAT PADI!" aata hai.
- **CPU LEVEL:** lobby me EASY / MEDIUM / HARD. Hard me CPU tez, nitro aur laat zyada.
- Track se bahar jungle ya nadi ki taraf ja sakte ho. **5 second** me wapas nahi aaye to game apne aap track par teleport kar dega.
- Nadi me gire, ped ya deewar se takraye, ya bahut zor se land kiya to crash hoga. Rider bike se alag gir jayega.

**Settings ⚙ me:** Control Mode (Left-Right buttons / Tilt / Joystick), Auto-Accelerate, Left-hand layout, Graphics (Low/Medium/High), FPS limit aur FPS counter, 16:9 ya Full screen, Camera, aur volume (Master / Music / Effects / Voice). Tutorial bhi yahin se dobara dekh sakte ho.
- **Tilt mode** ke liye link `https://` hona chahiye (cloudflared ya hosting wala). Local `http://` par phone tilt allow nahi karta.
- Phone garam ho ya game slow chale to Graphics **LOW** kar do.

---

## 🎵 Gaane aur awaazein
- **Songs:** aapka "Pahadi Nonstop mashup" 15 alag gaano me kaata gaya hai (`assets/songs/`). Music apne aap nahi bajta. **♫** chip / **▶** dabao, **⏭** se agla gaana. Race ke beech me bhi badal sakte ho.
  - Gaano ke naam badalne ho to `assets/songs/songs.json` me `"title"` edit karo.
- **Riders ki awaaz:** `voice overs` folder ki recordings (`assets/voice/`). Intro me har rider "MAIN HOON …" ke saath bolta hai, lobby me rider badalne par, laat maarne par, aur 💬 button par.
- **Game sounds:** countdown beeps, horn, whoosh, engine rev, jungle ke pakshi (`assets/sfx/`). Engine, hawa, jaanwar (sher, gaay, saanp, langur, haathi, mor), nadi, mandir ki ghanti aur background music code me synthesize hote hain.

---

## 📁 Folder
```
index.html, css/, js/        game ka code (Three.js, ES modules)
  js/world/                  track, terrain, nadi, aasmaan, jungle, cheezein lagana
  js/models/                 bikes, riders, jaanwar, log, gaadiyan, buildings, ped
  js/game/                   physics, CPU riders, camera, race
  js/audio/                  engine/music synth, voice lines, songs player
  js/net/                    multiplayer
assets/                      awaazein, gaane, fonts
vendor/                      three.js, PeerJS, QR code library
server.js                    game server + multiplayer (bina kisi npm install ke)
dev/                         developer test pages (khelne ke liye zaroorat nahi)
```

Credits: [three.js](https://threejs.org) (MIT), [PeerJS](https://peerjs.com) (MIT), qrcode-generator (MIT), Teko & Rajdhani fonts (SIL OFL).
