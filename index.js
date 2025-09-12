const express = require('express');
const requestIp = require('request-ip');
const maxmind = require('maxmind');
const path = require('path');
const axios = require('axios');
const { performance } = require('perf_hooks');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes with explicit configuration
app.use(cors({
    origin: '*', // Allow all origins
    methods: ['PUT', 'GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS'], // Allow HTTP methods
}));

app.use(requestIp.mw());

// Load MaxMind GeoLite2 database
let lookup;
maxmind.open(path.join(__dirname, 'GeoLite2-City.mmdb')).then((cityLookup) => {
    lookup = cityLookup;
});

// Load plugins dynamically from ./plugins
const plugins = {};
const pluginDir = path.join(__dirname, 'plugins');
fs.readdirSync(pluginDir).forEach(file => {
    const name = file.split('.')[0];
    plugins[name] = require(path.join(pluginDir, file));
});

//--------- RENDER BYPASS (YOU CAN IGNORE) ---------
const PING_URL = 'https://location-render-bypass.onrender.com/render-alive';
app.get('/render-alive', async (req, res) => {
  await pingRemoteServer();
  res.send('Ping sent');
});
async function pingRemoteServer() {
  try {
    const response = await axios.get(PING_URL);
    console.log(`[${new Date().toISOString()}] Ping successful: ${response.data}`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Ping failed:`, error.message);
  }
}
//--------- END - RENDER BYPASS (YOU CAN IGNORE) ---------

app.get('/json.gp', async (req, res) => {
    const start = performance.now();

    // Check if IP is provided as query parameter, otherwise use client IP
    let ip = req.query.ip || req.clientIp;
    
    // If no IP provided and client IP is localhost, use fallback
    if (!req.query.ip && (ip === '::1' || ip === '127.0.0.1')) {
        ip = '89.163.154.134'; // fallback IP for local testing
    }

    if (!lookup) {
        return res.status(500).json({ error: 'Geo database not loaded yet' });
    }

    const geo = lookup.get(ip);
    if (!geo) {
        return res.status(404).json({ error: 'Location not found' });
    }

    const location = geo.location || {};
    const subdivision = geo.subdivisions?.[0] || {};

    const response = {
        hoskes_locplugin_request: ip,
        hoskes_locplugin_status: 200,
        hoskes_locplugin_delay: '', // calculated later
        hoskes_locplugin_credit: "Returned data includes GeoLite2 data created by MaxMind, available from <a href='https://www.maxmind.com'>https://www.maxmind.com</a>.",
        hoskes_locplugin_city: geo.city?.names?.en || "",
        hoskes_locplugin_region: subdivision.names?.en || "",
        hoskes_locplugin_regionCode: subdivision.iso_code || "",
        hoskes_locplugin_regionName: subdivision.names?.en || "",
        hoskes_locplugin_countryCode: geo.country?.iso_code || "",
        hoskes_locplugin_countryName: geo.country?.names?.en || "",
        hoskes_locplugin_inEUunion: geo.country?.is_in_european_union ? 1 : 0,
        hoskes_locplugin_continentCode: geo.continent?.code || "",
        hoskes_locplugin_continentName: geo.continent?.names?.en || "",
        hoskes_locplugin_latitude: location.latitude?.toString() || "",
        hoskes_locplugin_longitude: location.longitude?.toString() || "",
        hoskes_locplugin_locationAccuracyRadius: location.accuracy_radius?.toString() || "",
        hoskes_locplugin_timezone: location.time_zone || ""
    };

    const requestedPlugins = (req.query.plugins || '').split(',').map(p => p.trim().toLowerCase());

    for (const pluginName of requestedPlugins) {
        if (plugins[pluginName]) {
            const pluginData = await plugins[pluginName](ip, {
                latitude: location.latitude,
                longitude: location.longitude,
                country_code: geo.country?.iso_code || ""
            });
            Object.assign(response, pluginData);
        }
    }

    response.hoskes_locplugin_delay = (performance.now() - start).toFixed(2) + 'ms';
    res.json(response);
});

app.listen(PORT, () => {
    console.log(`Hoskes LocPlugin API running at http://localhost:${PORT}/json.gp`);
});