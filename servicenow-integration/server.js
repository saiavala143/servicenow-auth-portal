require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// Middleware
app.use(cors()); 
app.use(express.json()); 
app.use(express.static('public')); // Serves the index.html from the 'public' folder

// --- ROUTE 1: SIGN UP (Create User) ---
// --- ROUTE 1: SIGN UP (Create User) ---
app.post('/api/signup', async (req, res) => {
    const { firstName, lastName, email, userId, password } = req.body;

    const snPayload = {
        first_name: firstName,
        last_name: lastName,
        email: email,
        user_name: userId,
        user_password: password,
        password_needs_reset: "false", 
        locked_out: "false"            
    };
    
    // Use admin credentials from .env to create the user
    const credentials = `${process.env.SERVICENOW_USERNAME}:${process.env.SERVICENOW_PASSWORD}`;
    const encodedCredentials = Buffer.from(credentials).toString('base64');

    try {
        const response = await axios({
            method: 'POST',
            // 👇 THIS IS THE ONLY LINE THAT CHANGED 👇
            url: `${process.env.SERVICENOW_INSTANCE}/api/1656894/custom_portal_auth/register`,
            headers: {
                'Authorization': `Basic ${encodedCredentials}`,
                'Content-Type': 'application/json'
            },
            data: snPayload
        });

        res.status(201).json({ message: 'User created successfully', sys_id: response.data.result.sys_id }); // Or response.data.result depending on how the scripted rest API returns it
    } catch (error) {
        console.error("Sign Up Error:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// --- ROUTE 2: LOG IN (Verify Credentials) ---
app.post('/api/login', async (req, res) => {
    const { userId, password } = req.body;

    // Use the USER'S typed credentials to attempt a login
    const userCredentials = Buffer.from(`${userId}:${password}`).toString('base64');

    try {
        const response = await axios({
            method: 'GET',
            url: `${process.env.SERVICENOW_INSTANCE}/api/now/table/sys_user?sysparm_limit=1`,
            headers: {
                'Authorization': `Basic ${userCredentials}` 
            }
        });

        res.status(200).json({ message: 'Login successful!', user: userId });

    } catch (error) {
        // Fix: 403 means the password was correct, but the user lacks roles to read the table.
        // For our custom portal, we consider this a successful login!
        if (error.response && error.response.status === 403) {
            res.status(200).json({ message: 'Login successful!', user: userId });
        } 
        // 401 specifically means bad password or username
        else if (error.response && error.response.status === 401) {
            res.status(401).json({ error: 'Invalid username or password' });
        } 
        // Any other server errors
        else {
            console.error("Login Error:", error.message);
            res.status(500).json({ error: 'An error occurred during login' });
        }
    }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});