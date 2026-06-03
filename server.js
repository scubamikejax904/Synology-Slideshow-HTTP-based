//Copyright 2026 By Michael Gartner
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//   you may not use this file except in compliance with the License.
//   You may obtain a copy of the License at
//
//       http://www.apache.org/licenses/LICENSE-2.0
//
//   Unless required by applicable law or agreed to in writing, software
//   distributed under the License is distributed on an "AS IS" BASIS,
//   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//   See the License for the specific language governing permissions and
//   limitations under the License.



require('dotenv').config();
var express = require('express');
var axios = require('axios');
var https = require('https');
var fs = require('fs').promises;
var path = require('path');
var { authenticator } = require('otplib');

var app = express();
app.use(express.json());

// CORS HEADERS
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "x-admin-token, Content-Type");
  next();
});

var NAS_URL = process.env.NAS_URL;
var PORT = process.env.PORT || 13535;
var SYNO_USER = process.env.SYNO_USER;
var SYNO_PASS = process.env.SYNO_PASS;
var ADMIN_TOKEN = process.env.ADMIN_TOKEN;
var TOTP_SECRET = process.env.TOTP_SECRET;

var API_VERSIONS = {
  auth:              7,
  browseAlbum:       5,
  browseNormalAlbum: 4,
  browseCondAlbum:   3,
  browseItem:        6,
  browseTag:         1,
  thumbnail:         2
};

if (!SYNO_USER || !SYNO_PASS || !ADMIN_TOKEN) {
  console.error('ERROR: Missing required env vars: SYNO_USER, SYNO_PASS, ADMIN_TOKEN');
  process.exit(1);
}

var httpsAgent = new https.Agent({ rejectUnauthorized: false });

var sid            = null;
var synoToken      = null;
var lastLogin      = 0;
var lastOtpWindow  = -1;
var SESSION_TIMEOUT = 50 * 60 * 1000;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Auth
function getOtpCode() {
  if (!TOTP_SECRET) return Promise.resolve('');
  var now        = Date.now();
  var window     = Math.floor(now / 30000);
  var windowAge  = (now % 30000);

  if (window === lastOtpWindow) {
    var waitMs = 30000 - windowAge + 500;
    console.log('Waiting ' + waitMs + 'ms for next OTP window...');
    return new Promise(function(resolve) {
      setTimeout(function() {
        try {
          var code = authenticator.generate(TOTP_SECRET);
          lastOtpWindow = Math.floor(Date.now() / 30000);
          resolve(code);
        } catch(e) { resolve(''); }
      }, waitMs);
    });
  }

  try {
    var code = authenticator.generate(TOTP_SECRET);
    lastOtpWindow = window;
    return Promise.resolve(code);
  } catch(e) {
    return Promise.resolve('');
  }
}

function getSid() {
  var now = Date.now();
  if (sid && now - lastLogin < SESSION_TIMEOUT) return Promise.resolve(sid);

  console.log('Authenticating...');
  return getOtpCode().then(function(otpCode) {
    var postData =
      'api=SYNO.API.Auth&version=' + API_VERSIONS.auth +
      '&method=login&account=' + encodeURIComponent(SYNO_USER) +
      '&passwd=' + encodeURIComponent(SYNO_PASS) +
      '&format=sid&enable_syno_token=yes' +
      (otpCode ? '&otp_code=' + encodeURIComponent(otpCode) : '');

    return axios.post(NAS_URL + '/webapi/auth.cgi', postData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      httpsAgent: httpsAgent, timeout: 30000
    });
  }).then(function(res) {
    if (!res.data || !res.data.success) {
      var code = (res.data && res.data.error && res.data.error.code) || '?';
      throw new Error('Auth failed: code=' + code);
    }
    sid = res.data.data.sid;
    synoToken = res.data.data.synotoken || null;
    lastLogin = Date.now();
    console.log('Auth OK');
    return sid;
  });
}

// Helper: Synology GET Request (FIXED: Uses params correctly & Headers for Token)
function synoGet(params) {
  return getSid().then(function(currentSid) {
    // Ensure _sid is present
    if (!params._sid) params._sid = currentSid;
    
    var headers = {};
    var parts = [];
    
    // Extract SynoToken from params and move it to Header for better compatibility
    if (params.SynoToken) {
      headers['X-SYNO-TOKEN'] = params.SynoToken;
      delete params.SynoToken; // Remove from URL params to keep it clean
    }

    for (var key in params) {
      if (params.hasOwnProperty(key) && params[key] != null) {
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key])));
      }
    }
    var url = NAS_URL + '/webapi/entry.cgi?' + parts.join('&');
    
    console.log('GET ' + url.replace(/_sid=[^&]+/, '_sid=REDACTED'));

    return axios.get(url, {
      httpsAgent: httpsAgent, 
      timeout: 60000, 
      headers: headers, 
      validateStatus: function() { return true; }
    }).then(function(res) {
      var data = res.data;
      
      // Session expired
      if (data && data.error && data.error.code === 105) {
        console.warn('Session expired, re-authing...');
        sid = null; lastLogin = 0; synoToken = null;
        return getSid().then(function(newSid) { 
          params._sid = newSid; 
          return synoGet(params); 
        });
      }
      
      // API error
      if (!data || !data.success) {
        var code = (data && data.error && data.error.code) || '?';
        console.error(' API error ' + code + ': [' + params.api + ']');
        throw new Error('API error ' + code);
      }
      return res; // Return full axios response
    });
  });
}

// Config Management
var CONFIG_PATH = path.join(__dirname, 'config.json');
function loadConfig() {
  return fs.readFile(CONFIG_PATH, 'utf8').then(function(data) { return JSON.parse(data); })
    .catch(function() {
      return { selectedAlbums: [], selectedTags: [], slideshowInterval: 5000, imageSize: 'xl', shuffle: true };
    });
}
function saveConfig(config) { return fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8'); }

// Auth Middleware
function requireAuth(req, res, next) {
  if (req.headers['x-admin-token'] === ADMIN_TOKEN) return next();
  if (!res.headersSent) res.status(401).json({ error: 'Unauthorized' });
}

// API Endpoints
app.post('/api/login', function(req, res) {
  if (req.body.password === ADMIN_TOKEN) res.json({ success: true, token: ADMIN_TOKEN });
  else if (!res.headersSent) res.status(401).json({ error: 'Invalid credentials' });
});

app.get('/api/config', function(req, res) {
  loadConfig().then(function(config) { delete config.adminPassword; res.json(config); });
});

app.post('/api/config', requireAuth, function(req, res) {
  loadConfig().then(function(config) {
    var u = req.body;
    if (u.selectedAlbums) config.selectedAlbums = u.selectedAlbums;
    if (u.selectedTags) config.selectedTags = u.selectedTags;
    if (u.slideshowInterval !== undefined) config.slideshowInterval = u.slideshowInterval;
    if (u.imageSize) config.imageSize = u.imageSize;
    if (u.shuffle !== undefined) config.shuffle = u.shuffle;
    return saveConfig(config);
  }).then(function() { res.json({ success: true }); })
    .catch(function(err) { if (!res.headersSent) res.status(500).json({ error: err.message }); });
});

// Reset Config Endpoint
app.post('/api/config/reset', requireAuth, function(req, res) {
  console.log('Resetting config to defaults...');
  var defaultConfig = { 
    selectedAlbums: [], 
    selectedTags: [], 
    slideshowInterval: 5000, 
    imageSize: 'xl', 
    shuffle: true 
  };
  saveConfig(defaultConfig).then(function() {
    console.log('Config reset complete');
    res.json({ success: true, message: 'Configuration reset to defaults' });
  }).catch(function(err) {
    console.error('Reset failed: ' + err.message);
    res.status(500).json({ error: 'Reset failed: ' + err.message });
  });
});

app.get('/api/albums', requireAuth, function(req, res) {
  getSid().then(function(currentSid) {
    return synoGet({ api: 'SYNO.Foto.Browse.Album', version: API_VERSIONS.browseAlbum, method: 'list', offset: 0, limit: 1000 });
  }).then(function(r) {
    var albums = (r.data && r.data.data && r.data.data.list) || [];
    console.log('Albums found: ' + albums.length);
    res.json(albums.map(function(a) {
      return {
        id: String(a.id),
        name: a.name || 'Untitled',
        type: a.type || (a.condition ? 'condition' : 'normal'),
        item_count: a.item_count || 0
      };
    }));
  }).catch(function(err) { console.error('Albums error: ' + err.message); if (!res.headersSent) res.json([]); });
});

app.get('/api/tags', requireAuth, function(req, res) {
  getSid().then(function(currentSid) {
    return synoGet({ 
      api: 'SYNO.Foto.Browse.GeneralTag', 
      version: API_VERSIONS.browseTag, 
      method: 'list', 
      offset: 0, 
      limit: 1000 
    });
  }).then(function(r) {
    var tags = (r.data && r.data.data && r.data.data.list) || [];
    console.log('Tags found: ' + tags.length);
    res.json(tags.map(function(t) { 
      return { 
        id: String(t.id), 
        name: t.name || 'Untitled', 
        item_count: t.count || t.item_count || 0 
      }; 
    }));
  }).catch(function(err) {
    console.log('Tags API failed: ' + err.message);
    if (!res.headersSent) res.json([]);
  });
});

// Fetch Logic
function fetchAlbumItems(albumEntry, currentSid) {
  var id = typeof albumEntry === 'object' ? albumEntry.id : albumEntry;
  var type = typeof albumEntry === 'object' ? albumEntry.type : 'normal';
  
  if (type === 'condition') {
    console.log('Fetching conditional album ' + id + '...');
    
    return synoGet({
      api: 'SYNO.Foto.Browse.ConditionAlbum',
      version: API_VERSIONS.browseCondAlbum,
      method: 'list',
      condition_id: parseInt(id),
      offset: 0,
      limit: 5000,
      additional: '["thumbnail"]'
    }).then(function(r) {
      var items = (r.data && r.data.list) || 
                  (r.data && r.data.data && r.data.data.list) || 
                  [];
                  
      console.log('  Cond album ' + id + ' -> ' + items.length + ' items');
      
      if (items.length > 0 && items[0].id < 100) {
        console.log('  Small IDs detected, trying fallback with normal Item API...');
        return synoGet({
          api: 'SYNO.Foto.Browse.Item',
          version: API_VERSIONS.browseItem,
          method: 'list',
          album_id: parseInt(id),
          offset: 0,
          limit: 5000,
          additional: '["thumbnail"]'
        }).then(function(r2) {
          var items2 = (r2.data && r2.data.data && r2.data.data.list) || [];
          console.log('  Fallback: Cond album ' + id + ' -> ' + items2.length + ' items');
          return items2;
        }).catch(function(err) {
          console.log('  Fallback failed: ' + err.message);
          return items;
        });
      }
      return items;
    }).catch(function(err) {
      console.error('  Cond album ' + id + ' failed: ' + err.message);
      console.log('  Trying fallback with normal Item API...');
      return synoGet({
        api: 'SYNO.Foto.Browse.Item',
        version: API_VERSIONS.browseItem,
        method: 'list',
        album_id: parseInt(id),
        offset: 0,
        limit: 5000,
        additional: '["thumbnail"]'
      }).then(function(r) {
        var items = (r.data && r.data.data && r.data.data.list) || [];
        console.log('  Fallback: Cond album ' + id + ' -> ' + items.length + ' items');
        return items;
      }).catch(function(err2) {
        console.error('  All fallbacks failed: ' + err2.message);
        return [];
      });
    });
  }
  
  return synoGet({
    api: 'SYNO.Foto.Browse.Item',
    version: API_VERSIONS.browseItem,
    method: 'list',
    album_id: parseInt(id),
    offset: 0,
    limit: 5000,
    additional: '["thumbnail"]'
  }).then(function(r) {
    var items = (r.data && r.data.data && r.data.data.list) || [];
    console.log('  Normal album ' + id + ' -> ' + items.length + ' items');
    return items;
  }).catch(function(err) { 
    console.error('Album items error: ' + err.message); 
    return []; 
  });
}

function fetchTagItems(tagId, currentSid) {
  var id = String(tagId);
  console.log('Fetching tag id=' + id);
  
  // Using rule-based filter for DSM 7.2+ compatibility
  var filterObj = { 
    rule: { 
      general_tag: { 
        op: "in", 
        value: [parseInt(id)] 
      } 
    } 
  };
  var filterStr = JSON.stringify(filterObj);
  console.log('   Using filter: ' + filterStr);

  return synoGet({
    api: 'SYNO.Foto.Browse.Item',
    version: API_VERSIONS.browseItem,
    method: 'list',
    filter: filterStr,
    offset: 0,
    limit: 5000,
    additional: '["thumbnail"]'
  }).then(function(r) {
    var items = (r.data && r.data.data && r.data.data.list) || [];
    console.log('  Tag ' + id + ' -> ' + items.length + ' items');
    
    // If filter is ignored and returns 5000, warn user
    if (items.length >= 5000) {
      console.warn('  Filter may have been ignored by Synology (returned max limit).');
    }
    return items;
  }).catch(function(err) { 
    console.error('Tag items error: ' + err.message); 
    return []; 
  });
}

// Photos Endpoint
app.get('/api/photos', function(req, res) {
  loadConfig().then(function(config) {
    if (!config.selectedAlbums.length && !config.selectedTags.length) {
      return { count: 0, ids: [], albums: 0, tags: 0, interval: 5000, imageSize: 'xl' };
    }
    return getSid().then(function(currentSid) {
      var promises = [];
      var seen = {};
      var photos = [];

      config.selectedAlbums.forEach(function(albumEntry) {
        promises.push(fetchAlbumItems(albumEntry, currentSid).then(function(items) {
          items.forEach(function(i) {
            if (!seen[i.id]) {
              seen[i.id] = true;
              var cacheKey = (i.additional && i.additional.thumbnail && i.additional.thumbnail.cache_key) 
                ? i.additional.thumbnail.cache_key 
                : String(i.id);
              photos.push({ id: String(i.id), cache_key: cacheKey });
            }
          });
        }));
      });

      config.selectedTags.forEach(function(tagEntry) {
        var tagId = typeof tagEntry === 'object' ? tagEntry.id : tagEntry;
        if (!tagId) return;
        promises.push(fetchTagItems(tagId, currentSid).then(function(items) {
          items.forEach(function(i) {
            if (!seen[i.id]) {
              seen[i.id] = true;
              var cacheKey = (i.additional && i.additional.thumbnail && i.additional.thumbnail.cache_key) 
                ? i.additional.thumbnail.cache_key 
                : String(i.id);
              photos.push({ id: String(i.id), cache_key: cacheKey });
            }
          });
        }));
      });

      return Promise.all(promises).then(function() {
        console.log('Unique photos collected: ' + photos.length);
        if (photos.length > 0) {
          console.log(' First photo: id=' + photos[0].id + ' cache_key=' + photos[0].cache_key);
        }
        if (config.shuffle) {
          for (var i = photos.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = photos[i]; photos[i] = photos[j]; photos[j] = t;
          }
        }
        return { count: photos.length, ids: photos, interval: config.slideshowInterval || 5000, imageSize: config.imageSize || 'xl' };
      });
    });
  }).then(function(r) { res.json(r); })
    .catch(function(err) { console.error('Photos error: ' + err.message); if (!res.headersSent) res.status(500).json({ error: err.message }); });
});

// IMAGE PROXY
app.get('/api/image', function(req, res) {
  var photoId = req.query.id;
  var originalCacheKey = req.query.cache_key || '';
  if (!photoId) return res.status(400).send('Missing photo ID');

  console.log('[IMAGE] Request: id=' + photoId + ' (original file)');

  return delay(10).then(function() {
    return getSid().then(function(currentSid) {
      var downloadParams = {
        api: 'SYNO.Foto.Download',
        version: 2,
        method: 'download',
        id: String(photoId),
        type: 'unit',
        force_download: true,
        _sid: currentSid
      };
      
      if (synoToken) downloadParams.SynoToken = synoToken;

      var downloadParts = [];
      for (var k in downloadParams) {
        if (downloadParams[k] != null && downloadParams[k] !== '') {
          downloadParts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(downloadParams[k])));
        }
      }
      var downloadUrl = NAS_URL + '/webapi/entry.cgi?' + downloadParts.join('&');

      return axios.get(downloadUrl, {
        httpsAgent: httpsAgent, responseType: 'arraybuffer', timeout: 30000, validateStatus: function(s) { return s < 500; }
      }).then(function(imgRes) {
        var ct = imgRes.headers['content-type'] || '';
        if (!ct.includes('text/html') && !ct.includes('application/json')) {
          console.log('[IMAGE] SUCCESS (Download API): ' + ct);
          res.set('Cache-Control', 'public, max-age=86400'); 
          res.set('Content-Type', ct);
          res.set('X-Image-Type', ct);
          return res.send(imgRes.data);
        }
        throw new Error('Download API failed, falling back to Thumbnail');
      }).catch(function(downloadErr) {
        console.log('[IMAGE] Download API failed, trying Thumbnail API...');
        
        var thumbParams = {
          api: 'SYNO.Foto.Thumbnail',
          version: 2,
          method: 'get',
          mode: 'download',
          id: photoId,
          type: 'unit',
          size: 'xl',
          _sid: currentSid
        };
        
        if (originalCacheKey) {
          var keyPrefix = originalCacheKey.split('_')[0];
          if (keyPrefix !== photoId && (parseInt(keyPrefix) > 1000 || (parseInt(photoId) < 100 && parseInt(keyPrefix) > parseInt(photoId)))) {
            console.log('[IMAGE] Thumbnail fallback: using cache_key prefix ' + keyPrefix + ' as photo ID');
            thumbParams.id = keyPrefix;
          }
          thumbParams.cache_key = originalCacheKey;
        }
        
        if (synoToken) thumbParams.SynoToken = synoToken;
        
        var thumbParts = [];
        for (var k in thumbParams) {
          if (thumbParams[k] != null) thumbParts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(thumbParams[k])));
        }
        var thumbUrl = NAS_URL + '/webapi/entry.cgi?' + thumbParts.join('&');
        
        return axios.get(thumbUrl, {
          httpsAgent: httpsAgent, responseType: 'arraybuffer', timeout: 30000, validateStatus: function(s) { return s < 500; }
        }).then(function(thumbRes) {
          var ct = thumbRes.headers['content-type'] || '';
          if (ct.includes('text/html') || ct.includes('application/json')) {
            var preview = Buffer.from(thumbRes.data).toString('utf8').substring(0, 300);
            console.error('[IMAGE] ERROR: Thumbnail API also failed: ' + preview.replace(/\n/g, ' '));
            return res.status(502).json({ error: 'Both APIs failed' });
          }
          console.log('[IMAGE] SUCCESS (Thumbnail API fallback): ' + ct);
          res.set('Cache-Control', 'public, max-age=86400'); 
          res.set('Content-Type', ct);
          res.set('X-Image-Type', ct);
          res.send(thumbRes.data);
        });
      });
    });
  }).catch(function(err) { 
    console.error('[IMAGE] ERROR: ' + err.message); 
    res.status(500).send('Auth error'); 
  });
});

// Health
app.get('/health', function(req, res) {
  res.json({ status: 'ok', session: sid ? 'active' : 'inactive', timestamp: Date.now() });
});

// STATIC FILES & CATCH-ALL
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', function(req, res) { res.sendFile(path.join(__dirname, 'public', 'slideshow.html')); });

// START SERVER
app.listen(PORT, '0.0.0.0', function() {
  console.log('Server running on port ' + PORT);
  console.log('Using API versions: ' + JSON.stringify(API_VERSIONS));
});
