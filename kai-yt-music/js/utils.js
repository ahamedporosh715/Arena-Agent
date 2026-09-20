// Extension map for downloaded audio blobs (KaiOS recognises m4a/mp3/ogg/opus/webm).
const MIME = {"audio/aac":"aac","audio/x-aac":"aac","audio/adpcm":"adp","application/vnd.audiograph":"aep","audio/x-aiff":"aif","audio/amr":"amr","audio/basic":"au","audio/x-caf":"caf","audio/vnd.dra":"dra","audio/vnd.dts":"dts","audio/vnd.dts.hd":"dtshd","audio/vnd.nuera.ecelp4800":"ecelp4800","audio/vnd.nuera.ecelp7470":"ecelp7470","audio/vnd.nuera.ecelp9600":"ecelp9600","audio/vnd.digital-winds":"eol","audio/x-flac":"flac","audio/flac":"flac","audio/vnd.lucent.voice":"lvp","audio/x-mpegurl":"m3u","audio/x-m4a":"m4a","audio/midi":"mid","audio/x-matroska":"mka","audio/mpeg":"mp3","audio/mp4":"m4a","audio/mobile-xmf":"mxmf","audio/ogg":"ogg","audio/opus":"opus","audio/vnd.ms-playready.media.pya":"pya","audio/x-realaudio":"ra","audio/x-pn-realaudio":"ram","audio/vnd.rip":"rip","audio/x-pn-realaudio-plugin":"rmp","audio/s3m":"s3m","application/vnd.yamaha.smaf-audio":"saf","audio/silk":"sil","audio/vnd.dece.audio":"uva","audio/x-wav":"wav","audio/wav":"wav","audio/x-ms-wax":"wax","audio/webm":"webm","video/webm":"webm","video/mp4":"mp4","audio/x-ms-wma":"wma","audio/xm":"xm"};

function convertTime(time) {
  if (typeof time === 'string') {
    var trimmed = time.trim();
    if (/^\d+(:\d{1,2}){1,2}$/.test(trimmed)) {
      return trimmed.replace(/^00:/, '');
    }
    time = parseFloat(trimmed);
  }
  if (typeof time !== 'number' || isNaN(time) || !isFinite(time) || time < 0) {
    return '00:00';
  }
  var hours = "";
  var mins = Math.floor(time / 60);
  if (mins > 59) {
    var hr = Math.floor(mins / 60);
    mins = Math.floor(mins - Number(60 * hr));
    hours = hr;
  }
  if (hours !== "") {
    if (hours < 10) {
      hours = "0" + String(hours) + ":";
    } else {
      hours = hours + ":";
    }
  }
  if (mins < 10) {
    mins = "0" + String(mins);
  }
  var secs = Math.floor(time % 60);
  if (secs < 10) {
    secs = "0" + String(secs);
  }
  return hours + mins + ":" + secs;
}

function readableFileSize(bytes, si = false, dp = 1) {
  if (typeof bytes !== 'number') {
    try {
      bytes = JSON.parse(bytes);
    } catch(e) {
      bytes = NaN;
    }
  }
  if (typeof bytes !== 'number' || isNaN(bytes) || !isFinite(bytes)) {
    return '0 Byte';
  }
  const thresh = si ? 1000 : 1024;
  if (Math.abs(bytes) < thresh) {
    return bytes + ' Byte';
  }
  const units = si  ? ['KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'] : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  let u = -1;
  const r = Math.pow(10, dp);
  do {
    bytes /= thresh;
    ++u;
  } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);
  return bytes.toFixed(dp) + '' + units[u];
}

function getURLParam(key, target) {
  var values = [];
  if (!target) target = location.href;

  key = key.replace(/[\[]/, "\\\[").replace(/[\]]/, "\\\]");

  var pattern = key + '=([^&#]+)';
  var o_reg = new RegExp(pattern,'ig');
  while (true){
    var matches = o_reg.exec(target);
    if (matches && matches[1]){
      values.push(matches[1]);
    } else {
      break;
    }
  }

  if (!values.length){
    return [];
  } else {
    return values.length == 1 ? [values[0]] : values;
  }
}

// Probe `/api/v1/stats` (not just the landing page): most public instances
// still serve HTML but have the JSON API switched off.
function checkDomainAvailability(list = [], callback = () => {}) {
  let result = [];
  if (!Array.isArray(list) || list.length === 0) {
    callback(result);
    return;
  }
  let remainingTask = list.length;
  list.forEach(u => {
    xhr('GET', `https://${u.uri}/api/v1/stats`, {}, {}, { 'Accept': 'application/json' }, { timeout: 8000 })
    .then((res) => {
      if (res.response && typeof res.response === 'object' && !res.response.error) {
        result.push(u);
      }
    })
    .catch(err => {})
    .then(() => {
      remainingTask--;
      if (remainingTask <= 0) {
        // keep a stable order: the currently selected instance first, then by name
        result.sort((a, b) => {
          if (a.uri === window['_INVIDIOUS_INSTANCE_']) return -1;
          if (b.uri === window['_INVIDIOUS_INSTANCE_']) return 1;
          return a.uri < b.uri ? -1 : (a.uri > b.uri ? 1 : 0);
        });
        callback(result);
      }
    });
  });
}

// Instances from https://api.invidious.io/instances.json that are https and
// have not disabled their API (`api: false`). Unknown (`null`) is kept.
function getInstance() {
  return new Promise((resolve, reject) => {
    xhr('GET', 'https://api.invidious.io/instances.json', {}, { sort_by: 'type,users' }, { 'Accept': 'application/json' }, { timeout: 12000 })
    .then(result => {
      let list = [];
      if (!Array.isArray(result.response)) {
        reject('Bad instances list');
        return;
      }
      result.response.forEach((instance) => {
        if (!Array.isArray(instance) || instance.length < 2 || !instance[1]) return;
        const meta = instance[1];
        if (meta.type !== 'https') return;
        if (meta.api === false) return;
        if (meta.monitor && meta.monitor.down === true) return;
        const uri = normalizeInstanceHost(instance[0]);
        if (!uri) return;
        const uptime = meta.monitor && typeof meta.monitor.uptime === 'number' ? Math.round(meta.monitor.uptime) : null;
        list.push({ uri: uri, region: meta.region || '', api: meta.api, uptime: uptime });
      });
      // healthiest first (unknown uptime last)
      list.sort((a, b) => (b.uptime == null ? -1 : b.uptime) - (a.uptime == null ? -1 : a.uptime));
      resolve(list);
    })
    .catch(err => {
      reject(err);
    });
  });
}

function getAvailableInvidiousInstance() {
  return new Promise((resolve, reject) => {
    getInstance()
    .catch((err) => {
      console.warn('api.invidious.io unreachable, using built-in list:', errorToString(err));
      return DEFAULT_INVIDIOUS_INSTANCES.map((uri) => ({ uri: uri, region: '' }));
    })
    .then(list => {
      // always include built-ins + the current instance so the user is never left with nothing
      const known = {};
      const merged = [];
      [].concat(list, DEFAULT_INVIDIOUS_INSTANCES.map((uri) => ({ uri: uri, region: '' })), [{ uri: window['_INVIDIOUS_INSTANCE_'], region: '' }]).forEach((item) => {
        const uri = normalizeInstanceHost(item && item.uri);
        if (!uri || known[uri]) return;
        known[uri] = true;
        merged.push({ uri: uri, region: item.region || '', uptime: item.uptime != null ? item.uptime : null });
      });
      checkDomainAvailability(merged, (result) => {
        try {
          window.localStorage.setItem('_INVIDIOUS_AVAILABLE_', JSON.stringify(result.map((r) => r.uri).slice(0, 10)));
        } catch (e) {}
        resolve(result);
      });
    })
    .catch(err => {
      reject(err);
    });
  });
}
