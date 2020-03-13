const {google} = require('googleapis');
const pRetry = require('p-retry');
let logger;

class GoogleDrive {
    oAuth2Client
    driveClient
    _data

    /**
     * Create a instance of Google Drive Driver
     *
     * @param {Number} id
     * @param {Object=} data
     */
    constructor(id, data = {}) {
        logger = require('../logger')(`Driver[${id}]: Google Drive`);
        if (data.oAuth) {
            let {
                client_id,
                client_secret,
                redirect_uri,
                token
            } = data.oAuth;
            this.oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);
            this.oAuth2Client.setCredentials(token);
        }

        if (data.drive) {
            this.driveClient = google.drive({
                version: "v3",
                auth: this.oAuth2Client,
            });
        }
        this._data = data;
    }

    /**
     * Authorize with code
     *
     * @param {Object} data Google Driver configuration
     *
     * @returns {Object} Google Driver configuration
     */
    async authorizeWithCode(data) {
        data = data.oAuth;
        if (!this.oAuth2Client) {
            let {
                client_id,
                client_secret,
                redirect_uri,
                code
            } = data;
            this.oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);
        }

        logger.info('Retrieving access token');
        return new Promise((resolve, reject) => {
            this.oAuth2Client.getToken(data.code, (error, token) => {
                if (error) {
                    logger.error('Error retrieving access token', error);
                    reject('Error retrieving access token');
                    return;
                }
                logger.info('Got access token');
                logger.debug(token);
                this.oAuth2Client.setCredentials(token);

                resolve({
                    client_id: data.client_id,
                    client_secret: data.client_secret,
                    redirect_uri: data.redirect_uri,
                    token,
                });
            });
        });
    }

    /**
     * Refresh Google API's access token
     *
     * @param {Object=} data Google Driver configuration
     *
     * @returns {Object} Google Driver configuration
     */
    async refreshToken(data) {
        if (!data) data = this._data;
        data = data.oAuth;
        if (!this.oAuth2Client) {
            let {
                client_id,
                client_secret,
                redirect_uri,
                token
            } = data;
            this.oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);
            this.oAuth2Client.setCredentials(token);
        }

        let expiry_date = this.oAuth2Client.credentials['expiry_date'];
        logger.debug('Token expiry date', expiry_date);
        if (((new Date()).getTime() + 600000) < expiry_date) return;

        logger.info('Refreshing access token');
        return new Promise((resolve, reject) => {
            this.oAuth2Client.refreshAccessToken((error, token) => {
                if (error) {
                    logger.error('Error refreshing access token', error);
                    reject('Error refreshing access token');
                    return;
                }

                logger.info('Got access token');
                logger.debug(token);
                resolve(token);
            });
        });
    }

    /**
     * Get file list
     *
     * @param {String} q Keywords
     * @param {String=} fields Selected fields
     * @param {Boolean=} full Get all files
     * @param {String} orderBy Order of the list
     *
     * @returns {Array} File list
     */
    async getFileList(q, fields, full, orderBy) {
        fields = fields || 'id, name, modifiedTime, parents, size';
        full = full || false;

        if (!this.checkAuthorizationStatus()) return;

        let data = [];
        let pageToken;
        let counter = 1;

        logger.info('Getting full file list of keyword', q);
        do {
            logger.debug(`Getting page ${counter}`);
            let params = {
                driveId: this._data.drive.driveId,
                corpora: 'drive',
                includeItemsFromAllDrives: true,
                supportsTeamDrives: true,
                pageSize: 1000,
                orderBy: orderBy ? orderBy : 'modifiedTime desc',
                q,
                fields: 'nextPageToken, files(' + fields + ')',
            };
            if (pageToken) params.pageToken = pageToken;
            let res = await pRetry(async () => {
                let result = await this.driveClient.files.list(params);

                return result;
            }, {
                onFailedAttempt: error => {
                    logger.error(`Attempt ${error.attemptNumber} failed. There are ${error.retriesLeft} retries left`);
                },
                retries: 3,
            });
            res = res.data;
            if (res.nextPageToken && full) pageToken = res.nextPageToken;
            else pageToken = null;
            data = data.concat(res.files);
            counter++;
        } while (pageToken);

        logger.info(`Got ${data.length} files' metadatas`);
        return data;
    }

    /**
     * Download file by fileId
     *
     * @param {String} fileId Google Drive fileId
     *
     * @returns {ArrayBuffer} File buffer
     */
    async downloadFile(fileId) {
        if (!this.checkAuthorizationStatus()) return;

        logger.info('Downloading file', fileId);

        let res = await pRetry(async () => {
            let result = await this.driveClient.files.get({
                corpora: 'drive',
                includeItemsFromAllDrives: true,
                supportsTeamDrives: true,
                driveId: this._data.drive.driveId,
                alt: 'media',
                fileId,
            }, {
                responseType: 'arraybuffer'
            });

            return result;
        }, {
            onFailedAttempt: error => {
                logger.error(`Attempt ${error.attemptNumber} failed. There are ${error.retriesLeft} retries left`);
            },
            retries: 3,
        });

        res = Buffer.from(res.data, 'binary');
        return res;
    }

    /**
     * Get class authorization status
     *
     * @returns {Boolean} status
     */
    checkAuthorizationStatus() {
        if (!this.oAuth2Client || !this.driveClient) {
            logger.error('Havn\'t authorize yet.');
            return false;
        }

        return true;
    }
}

module.exports = GoogleDrive;