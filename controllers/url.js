const { nanoid } = require('nanoid');
const URL = require('../models/url');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy');

async function generateSmartAlias(url) {
    if (!process.env.GEMINI_API_KEY) return null;
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `Generate a short, 1-3 word hyphenated URL slug based on the topic of this URL: ${url}. Return only the slug, nothing else, lowercase. Do not include any punctuation other than hyphens.`;
        const result = await model.generateContent(prompt);
        let slug = result.response.text().trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (slug.length > 30) slug = slug.substring(0, 30);
        if (slug.length < 3) return null;
        return slug;
    } catch (e) {
        console.error("Gemini AI Alias Generation failed:", e.message);
        return null;
    }
}

function getTopKeyFromMap(counterMap, fallback) {
    let topKey = fallback;
    let topCount = 0;

    Object.entries(counterMap).forEach(([key, count]) => {
        if (count > topCount) {
            topCount = count;
            topKey = key;
        }
    });

    return topKey;
}

function buildAnalyticsData(visitHistory = []) {
    const totalClicks = visitHistory.length;
    const uniqueCountries = new Set();
    const deviceBreakdown = { mobile: 0, desktop: 0, tablet: 0 };
    const countryCounter = {};
    const browserBreakdown = {};
    const deviceCounter = {};
    const browserCounter = {};
    const clicksByDate = {};

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 29; i >= 0; i -= 1) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const key = date.toISOString().slice(0, 10);
        clicksByDate[key] = 0;
    }

    visitHistory.forEach((visit) => {
        const country = visit.country || 'Unknown';
        const device = visit.device || 'desktop';
        const browser = visit.browser || 'Unknown';

        uniqueCountries.add(country);
        countryCounter[country] = (countryCounter[country] || 0) + 1;
        browserBreakdown[browser] = (browserBreakdown[browser] || 0) + 1;
        deviceCounter[device] = (deviceCounter[device] || 0) + 1;
        browserCounter[browser] = (browserCounter[browser] || 0) + 1;

        if (Object.prototype.hasOwnProperty.call(deviceBreakdown, device)) {
            deviceBreakdown[device] += 1;
        }

        const dateKey = new Date(visit.timestamp || Date.now()).toISOString().slice(0, 10);
        if (Object.prototype.hasOwnProperty.call(clicksByDate, dateKey)) {
            clicksByDate[dateKey] += 1;
        }
    });

    const topDevice = getTopKeyFromMap(deviceCounter, 'N/A');
    const topBrowser = getTopKeyFromMap(browserCounter, 'N/A');

    const countryBreakdown = Object.entries(countryCounter)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .reduce((acc, [country, count]) => {
            acc[country] = count;
            return acc;
        }, {});

    const recentVisits = [...visitHistory]
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 20);

    return {
        totalClicks,
        uniqueCountries: uniqueCountries.size,
        topDevice,
        topBrowser,
        clicksByDate,
        deviceBreakdown,
        countryBreakdown,
        browserBreakdown,
        recentVisits,
    };
}

async function handleGenerateNewShortURL(req, res) {
    const body = req.body;

    if (!body.url) {
        return res.status(400).json({ error: 'url is required' });
    }

    const customSlug = (body.customSlug || '').trim();
    let shortID = nanoid(6);

    if (customSlug) {
        const isValidSlug = /^[a-zA-Z0-9-]{3,30}$/.test(customSlug);
        if (!isValidSlug) {
            return res.redirect('/?error=slug_invalid');
        }

        const existing = await URL.findOne({ shortId: customSlug });
        if (existing) {
            return res.redirect('/?error=slug_taken');
        }

        shortID = customSlug;
    } else if (body.generateSmartAlias === 'on' || body.generateSmartAlias === 'true') {
        const aiSlug = await generateSmartAlias(body.url);
        if (aiSlug) {
            const existing = await URL.findOne({ shortId: aiSlug });
            if (!existing) {
                shortID = aiSlug;
            } else {
                shortID = `${aiSlug}-${nanoid(3)}`;
            }
        }
    }

    await URL.create({
        shortId: shortID,
        redirectURL: body.url,
        visitHistory: [],
        createdBy: req.user.id,
    });

    return res.redirect('/?id=' + shortID);
}

async function handleGetAnalytics(req, res) {
    const shortId = req.params.shortId;
    const result = await URL.findOne({ shortId });

    if (!result) {
        return res.status(404).json({ error: 'Short URL not found' });
    }

    const analyticsData = buildAnalyticsData(result.visitHistory || []);
    const acceptsJson = req.get('accept') && req.get('accept').includes('application/json');

    if (acceptsJson) {
        return res.json({
            totalClicks: analyticsData.totalClicks,
            analytics: result.visitHistory,
            analyticsData,
        });
    }

    return res.render('analytics', { url: result, analyticsData });
}

module.exports = {
    handleGenerateNewShortURL,
    handleGetAnalytics,
};
