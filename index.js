require('dotenv').config();

const express = require('express');
const rateLimit = require('express-rate-limit');
const geoip = require('geoip-lite');
const UAParser = require('ua-parser-js');
const { connectToMongoDB } = require('./connect');

const URL = require('./models/url');
const path = require('path');

const urlRoute = require('./routes/url');
const staticRoute = require('./routes/staticRouter');
const userRouter = require('./routes/user');

const cookieParser = require('cookie-parser');
const { redisClient } = require('./redis');

const app = express();
const PORT = process.env.PORT || 8002;

function isLocalAddress(ip) {
    const normalizedIp = (ip || '').replace('::ffff:', '');
    const private172Match = normalizedIp.match(/^172\.(\d{1,3})\./);
    const private172 = private172Match && Number(private172Match[1]) >= 16 && Number(private172Match[1]) <= 31;

    return (
        normalizedIp === '127.0.0.1' ||
        normalizedIp === '::1' ||
        normalizedIp.startsWith('192.168.') ||
        normalizedIp.startsWith('10.') ||
        private172
    );
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    const raw = (Array.isArray(forwarded) ? forwarded[0] : forwarded) || req.socket.remoteAddress || '';
    const first = String(raw).split(',')[0].trim();
    return first || 'Unknown';
}

function buildVisitMetadata(req) {
    const ip = getClientIp(req);
    const ua = new UAParser(req.headers['user-agent'] || '');
    const parsedUA = ua.getResult();

    const geo = geoip.lookup(ip);
    const isLocal = isLocalAddress(ip);

    let device = 'desktop';
    if (parsedUA.device && parsedUA.device.type === 'mobile') {
        device = 'mobile';
    } else if (parsedUA.device && parsedUA.device.type === 'tablet') {
        device = 'tablet';
    }

    return {
        timestamp: Date.now(),
        ip,
        country: isLocal ? 'Local' : (geo && geo.country) || 'Unknown',
        city: isLocal ? 'Local' : (geo && geo.city) || 'Unknown',
        device,
        browser: (parsedUA.browser && parsedUA.browser.name) || 'Unknown',
        os: (parsedUA.os && parsedUA.os.name) || 'Unknown',
        referrer: req.headers.referer || 'Direct',
    };
}

function isApiRequest(req) {
    const accept = req.get('accept') || '';
    const contentType = req.get('content-type') || '';
    return accept.includes('application/json') || contentType.includes('application/json') || req.path.startsWith('/api');
}

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        if (isApiRequest(req)) {
            return res.status(429).json({ error: 'Too many requests. Please try again in 15 minutes.' });
        }
        return res.status(429).send('Too many requests. Please try again in 15 minutes.');
    },
});

const urlCreationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        if (isApiRequest(req)) {
            return res.status(429).json({ error: 'URL creation limit exceeded. Please try again in an hour.' });
        }
        return res.status(429).send('URL creation limit exceeded. Please try again in an hour.');
    },
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        if (isApiRequest(req)) {
            return res.status(429).json({ error: 'Too many authentication attempts. Please try again later.' });
        }
        return res.status(429).send('Too many authentication attempts. Please try again later.');
    },
});

app.use(cookieParser());


//mongodb connection
    const mongoURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/short-url';

    connectToMongoDB(mongoURI)
        .then(() => console.log('MongoDB connected'))
        .catch((err) => console.log('MongoDB connection failed:', err.message));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(generalLimiter);
app.use('/url', (req, res, next) => {
    if (req.method === 'POST') {
        return urlCreationLimiter(req, res, next);
    }
    return next();
});
app.use('/user/login', (req, res, next) => {
    if (req.method === 'POST') {
        return authLimiter(req, res, next);
    }
    return next();
});
app.use('/user/signup', (req, res, next) => {
    if (req.method === 'POST') {
        return authLimiter(req, res, next);
    }
    return next();
});

app.use('/url', urlRoute);
app.use('/user', userRouter);
app.use('/', staticRoute);

app.set('view engine', 'ejs');
app.set('views', path.resolve('./views'));

app.get('/:shortId', async (req, res) => {
    const shortId = req.params.shortId;
    const visitMeta = buildVisitMetadata(req);

    try {
        const cached = await redisClient.get(`url:${shortId}`);

        if (cached) {
            const parsed = JSON.parse(cached);
            URL.findOneAndUpdate(
                { shortId },
                {
                    $push: {
                        visitHistory: visitMeta,
                    },
                }
            ).catch((error) => {
                console.error('Async visit history update failed:', error.message);
            });

            return res.redirect(parsed.redirectURL);
        }
    } catch (error) {
        console.error('Redis lookup failed:', error.message);
    }

    const entry = await URL.findOneAndUpdate(
        {
            shortId,
        },
        {
            $push: {
                visitHistory: visitMeta,
            },
        }
    );

    if (!entry) {
        return res.status(404).send('Short URL not found');
    }

    try {
        await redisClient.setex(
            `url:${shortId}`,
            3600,
            JSON.stringify({ redirectURL: entry.redirectURL })
        );
    } catch (error) {
        console.error('Redis cache set failed:', error.message);
    }

    return res.redirect(entry.redirectURL);
});

app.listen(PORT, () => console.log(`Server started at port : ${PORT}`));



process.on('uncaughtException', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`Port ${process.env.PORT} already in use. Retrying...`);
        process.exit(1);
    }
});
