/*
 * yt-scrapper.js — YouTube search (HTML/InnerTube scrape) with Invidious fallback.
 *
 * searchVideo(query)               → first page
 * searchVideo('', continuation)    → next page, `continuation` is the object
 *                                    returned as `json.continuation`
 *
 * Result shape (unchanged for the UI):
 *   { results: [{ video: {...}, uploader: {...} }, ...],
 *     estimatedResults, parser, continuation|null, nextPageToken|null }
 */

/**
 * Parse youtube search results from json sectionList array and add to json result object
 * @param {Array} contents - The array of sectionLists
 * @param {Object} json - The object being returned to caller
 */
function parseJsonFormat(contents, json) {
    (contents || []).forEach(sectionList => {
        try {
            if (sectionList.hasOwnProperty("itemSectionRenderer")) {
                sectionList.itemSectionRenderer.contents.forEach(content => {
                    parseRendererContent(content, json);
                });
            }
            else if (sectionList.hasOwnProperty("richItemRenderer")) {
                parseRendererContent(sectionList.richItemRenderer.content, json);
            }
            else if (sectionList.hasOwnProperty("continuationItemRenderer")) {
                json["nextPageToken"] = sectionList.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
            }
        }
        catch (ex) {
            // console.error("Failed to read contents for section list:", ex);
        }
    });
}

function parseRendererContent(content, json) {
    if (!content || typeof content !== 'object') return;
    try {
        if (content.hasOwnProperty("channelRenderer")) {
            json.results.push(parseChannelRenderer(content.channelRenderer));
        }
        if (content.hasOwnProperty("videoRenderer")) {
            const parsed = parseVideoRenderer(content.videoRenderer);
            if (parsed) json.results.push(parsed);
        }
        if (content.hasOwnProperty("radioRenderer")) {
            json.results.push(parseRadioRenderer(content.radioRenderer));
        }
        if (content.hasOwnProperty("playlistRenderer")) {
            json.results.push(parsePlaylistRenderer(content.playlistRenderer));
        }
        // "Latest from <channel>" / "People also watched" shelves hold plain videos
        if (content.hasOwnProperty("shelfRenderer")) {
            const shelf = content.shelfRenderer.content || {};
            const items = (shelf.verticalListRenderer && shelf.verticalListRenderer.items) ||
                          (shelf.horizontalListRenderer && shelf.horizontalListRenderer.items) || [];
            items.forEach(item => parseRendererContent(item, json));
        }
    }
    catch (ex) {
        // console.error("Failed to parse renderer:", ex);
    }
}

function runsToText(runs) {
    if (!Array.isArray(runs)) return '';
    return runs.reduce(comb, "");
}

function lastThumbnail(thumbnail) {
    try {
        const list = thumbnail.thumbnails;
        return list[list.length - 1].url;
    } catch (e) {
        return '';
    }
}

function navigationUrl(endpoint) {
    try {
        return `https://www.youtube.com${endpoint.commandMetadata.webCommandMetadata.url}`;
    } catch (e) {
        return '';
    }
}

/**
 * Parse a channelRenderer object from youtube search results
 */
function parseChannelRenderer(renderer) {
    let channel = {
        "id": renderer.channelId,
        "title": (renderer.title && renderer.title.simpleText) || runsToText(renderer.title && renderer.title.runs),
        "url": navigationUrl(renderer.navigationEndpoint),
        "snippet": renderer.descriptionSnippet ? runsToText(renderer.descriptionSnippet.runs) : "",
        "thumbnail_src": lastThumbnail(renderer.thumbnail),
        "video_count": renderer.videoCountText ? runsToText(renderer.videoCountText.runs) : "",
        "subscriber_count": renderer.subscriberCountText ? renderer.subscriberCountText.simpleText : "0 subscribers",
        "verified": isVerified(renderer.ownerBadges)
    };

    return { channel };
}

/**
 * Parse a playlistRenderer object from youtube search results
 */
function parsePlaylistRenderer(renderer) {
    let thumbnail_src = '';
    try {
        let thumbnails = renderer.thumbnailRenderer.playlistVideoThumbnailRenderer.thumbnail.thumbnails;
        thumbnail_src = thumbnails[thumbnails.length - 1].url;
    } catch (e) {}
    let playlist = {
        "id": renderer.playlistId,
        "title": (renderer.title && renderer.title.simpleText) || runsToText(renderer.title && renderer.title.runs),
        "url": navigationUrl(renderer.navigationEndpoint),
        "thumbnail_src": thumbnail_src,
        "video_count": renderer.videoCount
    };

    let uploader = { "username": "", "url": "" };
    try {
        uploader.username = renderer.shortBylineText.runs[0].text;
        uploader.url = navigationUrl(renderer.shortBylineText.runs[0].navigationEndpoint);
    } catch (e) {}

    return { playlist: playlist, uploader: uploader };
}

/**
 * Parse a radioRenderer object from youtube search results
 */
function parseRadioRenderer(renderer) {
    let radio = {
        "id": renderer.playlistId,
        "title": (renderer.title && renderer.title.simpleText) || runsToText(renderer.title && renderer.title.runs),
        "url": navigationUrl(renderer.navigationEndpoint),
        "thumbnail_src": lastThumbnail(renderer.thumbnail),
        "video_count": renderer.videoCountText ? runsToText(renderer.videoCountText.runs) : ""
    };

    let uploader = {
        "username": renderer.shortBylineText ? renderer.shortBylineText.simpleText : "YouTube"
    };

    return { radio: radio, uploader: uploader };
}

function isVerified(ownerBadges) {
    if (!Array.isArray(ownerBadges)) return false;
    return ownerBadges.some(badge => {
        try {
            return badge.metadataBadgeRenderer.style.indexOf("VERIFIED") > -1;
        } catch (e) {
            return false;
        }
    });
}

/**
 * Parse a videoRenderer object from youtube search results.
 * Returns null for live streams / upcoming premieres (no audio stream to play).
 */
function parseVideoRenderer(renderer) {
    if (!renderer || !renderer.videoId) return null;
    const isLive = !renderer.lengthText || (renderer.badges || []).some(b => {
        try { return b.metadataBadgeRenderer.style === 'BADGE_STYLE_TYPE_LIVE_NOW'; } catch (e) { return false; }
    });
    if (isLive) return null;

    let video = {
        "id": renderer.videoId,
        "title": runsToText(renderer.title && renderer.title.runs) || (renderer.title && renderer.title.simpleText) || renderer.videoId,
        "url": navigationUrl(renderer.navigationEndpoint) || `https://www.youtube.com/watch?v=${renderer.videoId}`,
        "duration": renderer.lengthText.simpleText || runsToText(renderer.lengthText.runs),
        "snippet": renderer.descriptionSnippet ?
                   renderer.descriptionSnippet.runs.reduce((a, b) => a + (b.bold ? `<b>${b.text}</b>` : b.text), ""):
                   "",
        "upload_date": renderer.publishedTimeText ? renderer.publishedTimeText.simpleText : "",
        "thumbnail_src": lastThumbnail(renderer.thumbnail) || `https://i.ytimg.com/vi/${renderer.videoId}/mqdefault.jpg`,
        "views": renderer.viewCountText ?
            (renderer.viewCountText.simpleText || runsToText(renderer.viewCountText.runs)) :
            "0 views"
    };

    let uploader = { "username": "", "url": "" };
    try {
        const owner = renderer.ownerText || renderer.shortBylineText || renderer.longBylineText;
        uploader.username = owner.runs[0].text;
        uploader.url = navigationUrl(owner.runs[0].navigationEndpoint);
    } catch (e) {}
    uploader.verified = isVerified(renderer.ownerBadges);

    return { video: video, uploader: uploader };
}

/**
 * Combine array containing objects in format { text: "string" } to a single string
 */
function comb(a, b) {
    return a + ((b && b.text) || '');
}

function formatSeconds(total) {
    total = parseInt(total, 10);
    if (isNaN(total) || total < 0) return '';
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = (h > 0 && m < 10 ? '0' : '') + m;
    const ss = (s < 10 ? '0' : '') + s;
    return (h > 0 ? h + ':' : '') + mm + ':' + ss;
}

/* ---------------- Invidious search fallback ---------------- */

function invidiousSearch(query, page) {
    page = page || 1;
    return withInstanceFailover((host) => {
        return invidiousGet(host, '/api/v1/search', {
            q: query,
            type: 'video',
            page: page,
            fields: 'type,videoId,title,author,authorUrl,lengthSeconds,viewCountText,viewCount,publishedText,liveNow,isUpcoming'
        }).then((list) => {
            if (!Array.isArray(list)) return Promise.reject('Bad search response');
            return { host: host, list: list };
        });
    })
    .then((res) => {
        const json = { results: [], parser: 'invidious', estimatedResults: '', nextPageToken: null, continuation: null };
        res.list.forEach((v) => {
            if (v.type !== 'video' || !v.videoId || v.liveNow || v.isUpcoming) return;
            json.results.push({
                video: {
                    id: v.videoId,
                    title: v.title || v.videoId,
                    url: `https://www.youtube.com/watch?v=${v.videoId}`,
                    duration: formatSeconds(v.lengthSeconds) || '',
                    snippet: '',
                    upload_date: v.publishedText || '',
                    thumbnail_src: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
                    views: v.viewCountText || (v.viewCount != null ? `${v.viewCount} views` : '')
                },
                uploader: { username: v.author || '', url: v.authorUrl ? `https://www.youtube.com${v.authorUrl}` : '', verified: false }
            });
        });
        if (res.list.length > 0) {
            json.continuation = { type: 'invidious', q: query, page: page + 1 };
            json.nextPageToken = String(page + 1);
        }
        return json;
    });
}

/* ---------------- YouTube search ---------------- */

function youtubeSearchPage(query) {
    var url = 'https://www.youtube.com/';
    var params = { hl: 'en', app: 'desktop' };
    if (query.trim().length > 0) {
        url = 'https://www.youtube.com/results';
        params.search_query = query;
        params.sp = 'EgIQAQ%3D%3D'; // type=video filter
    }
    return xhr('GET', url, {}, params, XHR_HEADER, { timeout: 20000 })
    .then((res) => {
        const html = typeof res.response === 'string' ? res.response : '';
        const json = { results: [], parser: 'json_format', estimatedResults: '0', nextPageToken: null, continuation: null };
        const cfg = extractInnertubeConfig(html);
        json.key = cfg.apiKey;
        const data = extractInitialData(html, 'ytInitialData');
        if (!data) {
            return Promise.reject('YouTube page not parsable');
        }
        json.estimatedResults = data.estimatedResults || "0";
        if (data.contents && data.contents.twoColumnSearchResultsRenderer) {
            json.parser += ".object_var";
            const sectionLists = data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;
            parseJsonFormat(sectionLists, json);
        }
        if (json.nextPageToken) {
            json.continuation = { type: 'youtube', token: json.nextPageToken, key: cfg.apiKey, clientVersion: cfg.clientVersion, visitorData: cfg.visitorData, q: query };
        }
        return json;
    });
}

function youtubeSearchContinuation(continuation) {
    const form = {
        context: {
            client: {
                clientName: "WEB",
                clientVersion: continuation.clientVersion || INNERTUBE_FALLBACK_CLIENT_VERSION,
                hl: 'en',
                gl: 'US'
            }
        },
        continuation: continuation.token
    };
    if (continuation.visitorData) form.context.client.visitorData = continuation.visitorData;
    const query = { prettyPrint: 'false' };
    if (continuation.key) query.key = continuation.key;
    return xhr('POST', 'https://www.youtube.com/youtubei/v1/search', form, query, XHR_HEADER, { timeout: 20000 })
    .then((res) => {
        const data = res.response;
        if (typeof data !== 'object' || data === null) return Promise.reject('Bad continuation response');
        const json = { results: [], parser: 'json_format.page_token', estimatedResults: data.estimatedResults || '', nextPageToken: null, continuation: null, key: continuation.key };
        const actions = data.onResponseReceivedCommands || data.onResponseReceivedActions || [];
        actions.forEach((a) => {
            const act = a.appendContinuationItemsAction || a.reloadContinuationItemsCommand;
            if (act && act.continuationItems) parseJsonFormat(act.continuationItems, json);
        });
        if (json.nextPageToken) {
            json.continuation = { type: 'youtube', token: json.nextPageToken, key: continuation.key, clientVersion: continuation.clientVersion, visitorData: continuation.visitorData, q: continuation.q };
        }
        return json;
    });
}

// Backwards compatible signature: searchVideo(query, key, pageToken)
//  - new style: searchVideo(query, continuationObject)
function searchVideo(query, key, pageToken) {
    query = (query || '').toString();
    var continuation = null;
    if (key && typeof key === 'object') {
        continuation = key;
    } else if (key && pageToken) {
        continuation = { type: 'youtube', token: pageToken, key: key, q: query };
    }

    if (continuation) {
        if (continuation.type === 'invidious') {
            return invidiousSearch(continuation.q, continuation.page);
        }
        return youtubeSearchContinuation(continuation)
        .catch((err) => {
            console.warn('YouTube continuation failed:', errorToString(err));
            if (continuation.q && continuation.q.trim().length > 0) {
                return invidiousSearch(continuation.q, 2);
            }
            return Promise.reject(errorToString(err));
        });
    }

    return youtubeSearchPage(query)
    .then((json) => {
        if (json.results.length === 0 && query.trim().length > 0) {
            return Promise.reject('No results from YouTube');
        }
        return json;
    })
    .catch((err) => {
        console.warn('YouTube search failed:', errorToString(err));
        if (query.trim().length === 0) {
            return { results: [], parser: 'none', estimatedResults: '0', nextPageToken: null, continuation: null };
        }
        return invidiousSearch(query, 1).catch((err2) => {
            return Promise.reject(errorToString(err2) || errorToString(err));
        });
    });
}
