"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaSocial = void 0;
/** Fixed Meta hosts only. No token in URLs, errors, stored responses or redirect destinations. */
class MetaSocial {
    request;
    constructor(request = fetch) {
        this.request = request;
    }
    async call(platform, version, token, path, values = {}, post = false) {
        if (!/^v\d{1,2}\.0$/.test(version) ||
            !/^(me|\d+)(\/(threads|threads_publish|media|media_publish))?$/.test(path))
            throw Error('SOCIAL_API_PATH_DENIED');
        const host = platform === 'threads' ? 'graph.threads.net' : 'graph.facebook.com';
        const url = new URL(`https://${host}/${version}/${path}`);
        if (!post)
            url.search = new URLSearchParams(values).toString();
        let response;
        try {
            response = await this.request(url, {
                method: post ? 'POST' : 'GET',
                redirect: 'error',
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...(post ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
                },
                ...(post ? { body: new URLSearchParams(values) } : {}),
                signal: AbortSignal.timeout(20000),
            });
        }
        catch {
            throw Error('SOCIAL_NETWORK_UNKNOWN');
        }
        if (!response.ok) {
            // Never expose Meta error bodies: some include user content or credential fragments.
            if (response.status === 401 || response.status === 403)
                throw Error('SOCIAL_PERMISSION_DENIED');
            if (response.status === 429)
                throw Error('SOCIAL_RATE_LIMIT');
            throw Error('SOCIAL_API_REJECTED');
        }
        const raw = await response.text();
        if (Buffer.byteLength(raw) > 65536)
            throw Error('SOCIAL_INVALID_RESPONSE');
        try {
            const data = JSON.parse(raw);
            if (!data || typeof data !== 'object' || Array.isArray(data) || data.error)
                throw Error();
            return data;
        }
        catch {
            throw Error('SOCIAL_INVALID_RESPONSE');
        }
    }
    async profile(platform, version, token, userId) {
        const data = await this.call(platform, version, token, userId, {
            fields: platform === 'threads' ? 'id,username' : 'id,username',
        });
        if (typeof data.id !== 'string' ||
            !/^\d+$/.test(data.id) ||
            typeof data.username !== 'string' ||
            data.username.length > 100)
            throw Error('SOCIAL_INVALID_RESPONSE');
        return { userId: data.id, username: data.username };
    }
    async create(account, token, text, imageUrl) {
        const data = await this.call(account.platform, account.apiVersion, token, account.userId + (account.platform === 'threads' ? '/threads' : '/media'), account.platform === 'threads' ? { media_type: 'TEXT', text } : { image_url: imageUrl, caption: text }, true);
        if (typeof data.id !== 'string' || !/^\d+$/.test(data.id))
            throw Error('SOCIAL_INVALID_RESPONSE');
        return data.id;
    }
    async ready(account, token, container) {
        const data = await this.call(account.platform, account.apiVersion, token, container, {
            fields: account.platform === 'threads' ? 'status' : 'status_code',
        });
        return data[account.platform === 'threads' ? 'status' : 'status_code'] === 'FINISHED';
    }
    async publish(account, token, container) {
        const data = await this.call(account.platform, account.apiVersion, token, account.userId + (account.platform === 'threads' ? '/threads_publish' : '/media_publish'), { creation_id: container }, true);
        if (typeof data.id !== 'string' || !/^\d+$/.test(data.id))
            throw Error('SOCIAL_INVALID_RESPONSE');
        return data.id;
    }
}
exports.MetaSocial = MetaSocial;
//# sourceMappingURL=meta-social.js.map