/**
 * FIXED yt-scrapper.js for KaiOS YT Music
 * Original bugs:
 * - Used old innertubeApiKey regex that broke with new YouTube layout
 * - Used old clientVersion 2.20201022 (outdated)
 * - Parsed old ytInitialData structure that YouTube changed
 * - No fallback to backend
 * 
 * FIXES:
 * - Uses backend /api/search for reliable search (InnerTube + yt-dlp fallback)
 * - Updated client versions and headers
 * - Proper error handling with retry
 * - Falls back to backend if direct scraping fails
 */

function getApiBase() {
  if (window.APP_CONFIG && window.APP_CONFIG.apiBase) return window.APP_CONFIG.apiBase;
  if (localStorage.getItem('kaiosApiBase')) return localStorage.getItem('kaiosApiBase');
  return '';
}
function api(path) {
  var base = getApiBase().replace(/\/+$/, '');
  return base + path;
}

function parseJsonFormat(contents, json) {
  if (!contents || !Array.isArray(contents)) return;
  contents.forEach(function(sectionList) {
    try {
      if (sectionList.hasOwnProperty("itemSectionRenderer")) {
        sectionList.itemSectionRenderer.contents.forEach(function(content) {
          try {
            if (content.hasOwnProperty("channelRenderer")) {
              json.results.push(parseChannelRenderer(content.channelRenderer));
            }
            if (content.hasOwnProperty("videoRenderer")) {
              json.results.push(parseVideoRenderer(content.videoRenderer));
            }
            if (content.hasOwnProperty("radioRenderer")) {
              json.results.push(parseRadioRenderer(content.radioRenderer));
            }
            if (content.hasOwnProperty("playlistRenderer")) {
              json.results.push(parsePlaylistRenderer(content.playlistRenderer));
            }
          } catch(ex) {
            console.log('Failed to parse renderer:', ex);
          }
        });
      } else if (sectionList.hasOwnProperty("richItemRenderer")) {
        try {
          var content = sectionList.richItemRenderer.content;
          if (content.hasOwnProperty("channelRenderer")) {
            json.results.push(parseChannelRenderer(content.channelRenderer));
          }
          if (content.hasOwnProperty("videoRenderer")) {
            json.results.push(parseVideoRenderer(content.videoRenderer));
          }
          if (content.hasOwnProperty("radioRenderer")) {
            json.results.push(parseRadioRenderer(content.radioRenderer));
          }
          if (content.hasOwnProperty("playlistRenderer")) {
            json.results.push(parsePlaylistRenderer(content.playlistRenderer));
          }
        } catch(ex) {
          console.log('Failed to parse richItem:', ex);
        }
      } else if (sectionList.hasOwnProperty("continuationItemRenderer")) {
        json["nextPageToken"] = sectionList.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
      }
    } catch (ex) {
      console.log('Failed to read section list:', ex);
    }
  });
}

function parseChannelRenderer(renderer) {
  try {
    var channel = {
      "id": renderer.channelId,
      "title": renderer.title.simpleText || (renderer.title.runs && renderer.title.runs[0].text) || 'Unknown Channel',
      "url": "https://www.youtube.com" + (renderer.navigationEndpoint.commandMetadata.webCommandMetadata.url || '/channel/' + renderer.channelId),
      "snippet": renderer.descriptionSnippet ? renderer.descriptionSnippet.runs.reduce(comb, "") : "",
      "thumbnail_src": renderer.thumbnail.thumbnails[renderer.thumbnail.thumbnails.length - 1].url,
      "video_count": renderer.videoCountText ? renderer.videoCountText.runs.reduce(comb, "") : "",
      "subscriber_count": renderer.subscriberCountText ? renderer.subscriberCountText.simpleText : "0 subscribers",
      "verified": renderer.ownerBadges && renderer.ownerBadges.some(function(badge) { return badge.metadataBadgeRenderer.style.indexOf("VERIFIED") > -1; }) || false
    };
    return { channel: channel };
  } catch(e) {
    console.log('parseChannelRenderer error', e);
    return { channel: { id: renderer.channelId || 'unknown', title: 'Unknown' } };
  }
}

function parsePlaylistRenderer(renderer) {
  try {
    var thumbnails = renderer.thumbnailRenderer.playlistVideoThumbnailRenderer.thumbnail.thumbnails;
    var playlist = {
      "id": renderer.playlistId,
      "title": renderer.title.simpleText || 'Unknown Playlist',
      "url": "https://www.youtube.com" + renderer.navigationEndpoint.commandMetadata.webCommandMetadata.url,
      "thumbnail_src": thumbnails[thumbnails.length - 1].url,
      "video_count": renderer.videoCount
    };
    var uploader = {
      "username": renderer.shortBylineText.runs[0].text,
      "url": "https://www.youtube.com" + renderer.shortBylineText.runs[0].navigationEndpoint.commandMetadata.webCommandMetadata.url
    };
    return { playlist: playlist, uploader: uploader };
  } catch(e) {
    return { playlist: { id: renderer.playlistId, title: 'Unknown' } };
  }
}

function parseRadioRenderer(renderer) {
  try {
    var radio = {
      "id": renderer.playlistId,
      "title": renderer.title.simpleText,
      "url": "https://www.youtube.com" + renderer.navigationEndpoint.commandMetadata.webCommandMetadata.url,
      "thumbnail_src": renderer.thumbnail.thumbnails[renderer.thumbnail.thumbnails.length - 1].url,
      "video_count": renderer.videoCountText.runs.reduce(comb, "")
    };
    var uploader = {
      "username": renderer.shortBylineText ? renderer.shortBylineText.simpleText : "YouTube"
    };
    return { radio: radio, uploader: uploader };
  } catch(e) {
    return { radio: { id: renderer.playlistId, title: 'Mix' } };
  }
}

function parseVideoRenderer(renderer) {
  try {
    var video = {
      "id": renderer.videoId,
      "title": renderer.title.runs ? renderer.title.runs.reduce(comb, "") : (renderer.title.simpleText || 'Unknown'),
      "url": "https://www.youtube.com" + (renderer.navigationEndpoint.commandMetadata.webCommandMetadata.url || '/watch?v=' + renderer.videoId),
      "duration": renderer.lengthText ? renderer.lengthText.simpleText : "Live",
      "snippet": renderer.descriptionSnippet ? renderer.descriptionSnippet.runs.reduce(function(a, b) { return a + (b.bold ? "<b>" + b.text + "</b>" : b.text); }, "") : "",
      "upload_date": renderer.publishedTimeText ? renderer.publishedTimeText.simpleText : "Live",
      "thumbnail_src": renderer.thumbnail.thumbnails[renderer.thumbnail.thumbnails.length - 1].url,
      "views": renderer.viewCountText ? renderer.viewCountText.simpleText || renderer.viewCountText.runs.reduce(comb, "") : (renderer.publishedTimeText ? "0 views" : "0 watching")
    };
    var uploader = {
      "username": renderer.ownerText ? renderer.ownerText.runs[0].text : 'Unknown',
      "url": "https://www.youtube.com" + (renderer.ownerText && renderer.ownerText.runs[0].navigationEndpoint.commandMetadata.webCommandMetadata.url || '')
    };
    uploader.verified = renderer.ownerBadges && renderer.ownerBadges.some(function(badge) { return badge.metadataBadgeRenderer.style.indexOf("VERIFIED") > -1; }) || false;
    return { video: video, uploader: uploader };
  } catch(e) {
    console.log('parseVideoRenderer error', e);
    return { video: { id: renderer.videoId, title: 'Unknown Video', url: 'https://www.youtube.com/watch?v=' + renderer.videoId } };
  }
}

function comb(a, b) {
  return a + b.text;
}

// FIXED: searchVideo now uses backend first
function searchVideo(query, key, pageToken) {
  var json = { results: [] };
  return new Promise(function(resolve, reject) {
    // FIXED: Try backend first - reliable
    if (!key) {
      var xhr = new XMLHttpRequest({ mozSystem: true });
      xhr.open('GET', api('/api/search?q=' + encodeURIComponent(query) + '&type=video&limit=10'), true);
      xhr.timeout = 20000;
      xhr.onload = function() {
        if (this.status >= 200 && this.status < 400) {
          try {
            var data = JSON.parse(this.responseText);
            if (data.ok && data.results) {
              var items = data.results.items || [];
              json.results = items.map(function(item) {
                return {
                  video: {
                    id: item.video_id || item.id,
                    title: item.title,
                    url: item.url,
                    thumbnail_src: item.thumbnail,
                    duration: item.duration || '',
                    views: item.views || ''
                  },
                  uploader: {
                    username: item.channel || ''
                  }
                };
              });
              json["parser"] = "backend_fixed";
              json["key"] = "backend";
              resolve(json);
              return;
            }
          } catch(e) {
            console.log('Backend parse failed, trying direct', e);
          }
        }
        // Fallback to direct YouTube scraping
        fallbackSearch(query, key, pageToken, json, resolve, reject);
      };
      xhr.onerror = function() {
        fallbackSearch(query, key, pageToken, json, resolve, reject);
      };
      xhr.ontimeout = function() {
        fallbackSearch(query, key, pageToken, json, resolve, reject);
      };
      xhr.send();
    } else {
      // Pagination with key
      json["parser"] = "json_format.page_token";
      json["key"] = key;
      var form = {
        context: {
          client: {
            clientName: "WEB",
            clientVersion: "2.20240601.00.00",
          },
        },
        continuation: pageToken
      };
      var xhr2 = new XMLHttpRequest({ mozSystem: true });
      xhr2.open('POST', 'https://www.youtube.com/youtubei/v1/search?app=desktop&key=' + key, true);
      xhr2.setRequestHeader('Content-Type', 'application/json');
      xhr2.onload = function() {
        if (this.status >= 200 && this.status < 400) {
          try {
            var data = JSON.parse(this.responseText);
            parseJsonFormat(data.onResponseReceivedCommands[0].appendContinuationItemsAction.continuationItems, json);
            resolve(json);
          } catch(e) {
            reject(e);
          }
        } else {
          reject('HTTP ' + this.status);
        }
      };
      xhr2.onerror = function() { reject('Network error'); };
      xhr2.send(JSON.stringify(form));
    }
  });
}

function fallbackSearch(query, key, pageToken, json, resolve, reject) {
  var URL = 'https://www.youtube.com/';
  if (query.trim().length > 0) {
    URL = 'https://www.youtube.com/results?app=desktop&search_query=' + encodeURIComponent(query);
  }
  var xhr = new XMLHttpRequest({ mozSystem: true });
  xhr.open('GET', URL, true);
  xhr.setRequestHeader('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0');
  xhr.onload = function() {
    if (this.status >= 200 && this.status < 400) {
      try {
        var response = this.responseText;
        json["parser"] = "json_format";
        var keyMatch = response.match(/"innertubeApiKey":"([^"]*)/);
        if (keyMatch) json["key"] = keyMatch[1];
        var start = response.search(/var ytInitialData = /);
        if (start > -1) {
          var s = response.substring(start, response.length).replace(/var ytInitialData = /, '');
          var objStr = s.substring(0, s.indexOf(';</script>'));
          var data = JSON.parse(objStr);
          json["estimatedResults"] = data.estimatedResults || "0";
          if (data.contents.twoColumnSearchResultsRenderer) {
            json["parser"] += ".object_var";
            var sectionLists = data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;
            parseJsonFormat(sectionLists, json);
          }
          resolve(json);
        } else {
          // Try new structure
          var start2 = response.search(/ytInitialData/);
          if (start2 > -1) {
            var s2 = response.substring(start2);
            var match = s2.match(/ytInitialData\s*=\s*(\{.*?\});/);
            if (match) {
              var data2 = JSON.parse(match[1]);
              // Try to find search results in new layout
              var contents = data2.contents || {};
              if (contents.twoColumnSearchResultsRenderer) {
                var sec = contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;
                parseJsonFormat(sec, json);
              }
              resolve(json);
            } else {
              resolve(json);
            }
          } else {
            resolve(json);
          }
        }
      } catch(e) {
        console.log('Fallback search parse error', e);
        resolve(json);
      }
    } else {
      reject('HTTP ' + this.status);
    }
  };
  xhr.onerror = function() { reject('Network error'); };
  xhr.send();
}
