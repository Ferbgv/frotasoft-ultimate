const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const db = new sqlite3.Database('./rastreamento.db');

app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'chave-mestra-gps', resave: false, saveUninitialized: true }));

db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS frota (id INTEGER PRIMARY KEY AUTOINCREMENT, viatura TEXT, lat REAL, lng REAL, status TEXT, velocidade INTEGER, data TEXT)");
});

// LOGIN
app.get('/login', (req, res) => {
    res.send(`<body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#121416;font-family:sans-serif;color:white;">
        <form action="/login" method="POST" style="background:#212529;padding:40px;border-radius:15px;width:320px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.5);">
            <h1 style="color:#0d6efd;margin-bottom:20px;">FROTA PRO</h1>
            <input type="text" name="user" placeholder="Usuário" style="width:100%;padding:12px;margin:10px 0;border-radius:5px;border:none;">
            <input type="password" name="pass" placeholder="Senha" style="width:100%;padding:12px;margin:10px 0;border-radius:5px;border:none;">
            <button type="submit" style="width:100%;padding:12px;background:#0d6efd;color:white;border:none;border-radius:5px;cursor:pointer;font-weight:bold;">ACESSAR PAINEL</button>
        </form>
    </body>`);
});

app.post('/login', (req, res) => {
    if (req.body.user === 'admin' && req.body.pass === '1234') { req.session.autenticado = true; res.redirect('/'); } 
    else { res.send("<script>alert('Acesso negado!'); window.location='/login';</script>"); }
});

// DASHBOARD PRINCIPAL
app.get('/', (req, res) => {
    if (!req.session.autenticado) return res.redirect('/login');
    const v_selecionada = req.query.v || '';
    
    db.all("SELECT * FROM frota GROUP BY viatura HAVING id = MAX(id)", [], (err, frotas) => {
        db.all("SELECT lat, lng, data FROM frota WHERE viatura = ? ORDER BY id ASC", [v_selecionada], (err, historico) => {
            
            const listaViaturas = frotas.map(r => {
                let cor = r.status === 'Movimento' ? '#28a745' : r.status === 'Rolanti' ? '#ffc107' : '#dc3545';
                return `<div class="v-card" data-nome="${r.viatura.toLowerCase()}" onclick="location.href='/?v=${r.viatura}'" style="border-left:8px solid ${cor}; padding:12px; margin-bottom:8px; background:white; cursor:pointer; border-radius:6px; color:#333; box-shadow:0 2px 4px rgba(0,0,0,0.1);">
                    <strong style="font-size:15px;">${r.viatura}</strong><br>
                    <small style="font-weight:bold;color:${cor}">${r.status}</small> | <small>${r.velocidade} km/h</small>
                </div>`;
            }).join('');

            res.send(`
                <body style="margin:0; display:flex; font-family:'Segoe UI', Tahoma, sans-serif; background:#f4f7f6;">
                    <div style="width:340px; height:100vh; background:#1a1d20; color:white; padding:20px; overflow-y:auto; z-index:1001; box-sizing:border-box;">
                        <h2 style="color:#0d6efd;margin-top:0;">CENTRAL GPS</h2>
                        <input type="text" id="buscaV" onkeyup="filterV()" placeholder="🔍 Filtrar viatura..." style="width:100%; padding:10px; margin-bottom:15px; border-radius:5px; border:none;">
                        <button onclick="location.href='/simular'" style="width:100%; padding:12px; background:#198754; color:white; border:none; cursor:pointer; margin-bottom:20px; border-radius:5px; font-weight:bold;">🚀 GERAR MOVIMENTO</button>
                        <div id="lista">${listaViaturas || '<p style="color:#666;">Aguardando dados...</p>'}</div>
                        <hr style="border:0; border-top:1px solid #333; margin:20px 0;">
                        <button onclick="location.href='/logout'" style="width:100%; background:#444; color:white; border:none; padding:8px; border-radius:5px; cursor:pointer;">Sair do Sistema</button>
                    </div>

                    <div style="position:absolute; top:15px; left:360px; z-index:1000; width:350px;">
                        <input type="text" id="searchLoc" placeholder="📍 Para onde a viatura vai?" style="width:100%; padding:12px; border-radius:8px; border:none; box-shadow:0 4px 12px rgba(0,0,0,0.2);">
                        <button onclick="findLoc()" style="position:absolute; right:5px; top:5px; padding:7px 15px; background:#0d6efd; color:white; border:none; border-radius:5px; cursor:pointer;">Buscar</button>
                    </div>

                    <div id="map" style="flex:1; height:100vh;"></div>

                    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
                    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                    <script>
                        var map = L.map('map', {zoomControl: false}).setView([-8.83, 13.23], 13);
                        L.control.zoom({position: 'bottomright'}).addTo(map);

                        // --- DEFINIÇÃO DAS CAMADAS DE MAPA ---
                        var mapaRua = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                            attribution: '© OpenStreetMap'
                        });

                        var satelite = L.tileLayer('http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}',{
                            maxZoom: 20, subdomains:['mt0','mt1','mt2','mt3']
                        });

                        var terreno = L.tileLayer('http://{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',{
                            maxZoom: 20, subdomains:['mt0','mt1','mt2','mt3']
                        });

                        var hibrido3D = L.tileLayer('http://{s}.google.com/vt/lyrs=y,h&x={x}&y={y}&z={z}',{
                            maxZoom: 20, subdomains:['mt0','mt1','mt2','mt3']
                        });

                        // Adiciona o Mapa Padrão
                        satelite.addTo(map);

                        // --- CONTROLE DE CAMADAS (Botão de Escolha) ---
                        var baseMaps = {
                            "🛰️ Satélite": satelite,
                            "🗺️ Mapa de Ruas": mapaRua,
                            "⛰️ Terreno": terreno,
                            "🏙️ Híbrido/3D": hibrido3D
                        };
                        L.control.layers(baseMaps, null, {position: 'topright', collapsed: false}).addTo(map);

                        // --- FUNÇÕES DE BUSCA ---
                        function filterV() {
                            let val = document.getElementById('buscaV').value.toLowerCase();
                            let cards = document.getElementsByClassName('v-card');
                            for(let c of cards) { c.style.display = c.getAttribute('data-nome').includes(val) ? "block" : "none"; }
                        }

                        async function findLoc() {
                            let q = document.getElementById('searchLoc').value;
                            let res = await fetch('https://nominatim.openstreetmap.org/search?format=json&q='+q);
                            let d = await res.json();
                            if(d[0]) { map.setView([d[0].lat, d[0].lon], 15); L.marker([d[0].lat, d[0].lon]).addTo(map).bindPopup(q).openPopup(); }
                        }

                        // --- HISTÓRICO E PONTOS ---
                        var path = ${JSON.stringify(historico || [])};
                        if (path.length > 0) {
                            var coords = path.map(p => [p.lat, p.lng]);
                            L.polyline(coords, {color: '#00fbff', weight: 5, opacity: 0.8}).addTo(map);
                            L.marker(coords[coords.length-1]).addTo(map).bindPopup("<b>${v_selecionada}</b>").openPopup();
                            map.fitBounds(coords);
                        }
                    </script>
                </body>
            `);
        });
    });
});

app.get('/simular', (req, res) => {
    const f = ['Hilux-V8-01', 'Volvo-Cargo', 'Viatura-02', 'L200-PickUp'];
    const n = f[Math.floor(Math.random()*f.length)];
    const lat = -8.83 + (Math.random()*0.08);
    const lng = 13.23 + (Math.random()*0.08);
    db.run("INSERT INTO frota (viatura, lat, lng, status, velocidade, data) VALUES (?,?,?,?,?,?)", 
           [n, lat, lng, 'Movimento', 75, new Date().toLocaleString()], () => res.redirect('/'));
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });
app.listen(3000, () => console.log("FrotaSoft Ultimate Online"));