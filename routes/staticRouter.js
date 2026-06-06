const express = require('express');
const URL = require('../models/url');
const router = express.Router();
const jwt = require('jsonwebtoken');
const qrcode = require('qrcode');


// SSR(server side rendering) route to render home page with all URLs
router.get('/', async (req, res) => {
    try {
        const token = req.cookies?.token;
        let user = null;
        let allURL = [];

        if (token) {
            try {
                user = jwt.verify(token, process.env.JWT_SECRET);
                const urls = await URL.find({ createdBy: user.id });
                
                // attach qr code for each url
                allURL = await Promise.all(urls.map(async (u) => {
                    const shortLink = `http://localhost:${process.env.PORT || 8002}/${u.shortId}`;
                    const qrDataUrl = await qrcode.toDataURL(shortLink, { width: 100, margin: 1 });
                    return { ...u.toObject(), qrDataUrl };
                }));
            } catch (e) {
                res.clearCookie('token'); // expired/invalid token clear karo
            }
        }

        res.render('home', { 
            allURL, 
            user, 
            id: req.query.id || null, 
            error: req.query.error || null 
        });
    } catch (error) {
        console.error('Error fetching URLs:', error);
        res.status(500).send('Internal Server Error');
    }
});

router.get('/signup', (req, res) => {
    const token = req.cookies?.token;
    if (token) return res.redirect('/');
    return res.render("signup");
})
router.get('/login', (req, res) => {
    const token = req.cookies?.token;
    if (token) return res.redirect('/');
    return res.render("login");
})
router.get('/logout', (req, res) => {
    res.clearCookie('token');
    return res.redirect('/login');
})


module.exports = router;
