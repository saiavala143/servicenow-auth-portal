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
// --- ROUTE 3: RESET PASSWORD ---
app.put('/api/reset-password', async (req, res) => {
    const { userId, newPassword } = req.body;

    // Use your API User credentials from the .env file
    const credentials = `${process.env.SERVICENOW_USERNAME}:${process.env.SERVICENOW_PASSWORD}`;
    const encodedCredentials = Buffer.from(credentials).toString('base64');

    try {
        const response = await axios({
            method: 'PUT',
            // Notice the namespace 1656894 and the /reset-password path
            url: `${process.env.SERVICENOW_INSTANCE}/api/1656894/custom_portal_auth/reset-password`,
            headers: {
                'Authorization': `Basic ${encodedCredentials}`,
                'Content-Type': 'application/json'
            },
            data: {
                user_name: userId,
                new_password: newPassword
            }
        });

        res.status(200).json({ message: 'Password updated successfully!' });
    } catch (error) {
        console.error("Reset Error:", error.response ? error.response.data : error.message);
        // If ServiceNow sends a 404 (User not found), pass that specific error to the frontend
        if (error.response && error.response.status === 404) {
            res.status(404).json({ error: 'User ID not found' });
        } else {
            res.status(500).json({ error: 'Failed to reset password' });
        }
    }
});
// --- ROUTE 4: AI-POWERED IT TICKET CREATION ---
app.post('/api/create-ticket', async (req, res) => {
    const { userId, description } = req.body;

    try {
        // 1. Ask Hugging Face to analyze the sentiment of the text
        // Using a fast, standard model for positive/negative sentiment
        const hfResponse = await axios({
            method: 'POST',
            url: 'https://api-inference.huggingface.co/models/distilbert/distilbert-base-uncased-finetuned-sst-2-english',
            headers: {
                'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
                'Content-Type': 'application/json'
            },
            data: { inputs: description }
        });

        // Extract the result (e.g., "NEGATIVE" or "POSITIVE")
        const sentiment = hfResponse.data[0][0].label;
        const score = hfResponse.data[0][0].score;

        // 2. Triage Logic: Determine ServiceNow Urgency
        // Urgency 1 = High, Urgency 2 = Medium, Urgency 3 = Low
        let ticketUrgency = "3"; // Default to Low
        let aiNote = `AI Sentiment Analysis: ${sentiment} (Confidence: ${(score * 100).toFixed(1)}%). Normal priority assigned.`;

        if (sentiment === 'NEGATIVE' && score > 0.8) {
            ticketUrgency = "1"; // High urgency for highly frustrated users
            aiNote = `AI Sentiment Analysis: ${sentiment} (Confidence: ${(score * 100).toFixed(1)}%). Escalated to HIGH priority due to user frustration.`;
        }

        // 3. Create the Incident in ServiceNow
        const snCredentials = `${process.env.SERVICENOW_USERNAME}:${process.env.SERVICENOW_PASSWORD}`;
        const encodedSnAuth = Buffer.from(snCredentials).toString('base64');

        const snResponse = await axios({
            method: 'POST',
            url: `${process.env.SERVICENOW_INSTANCE}/api/now/table/incident`,
            headers: {
                'Authorization': `Basic ${encodedSnAuth}`,
                'Content-Type': 'application/json'
            },
            data: {
                short_description: `Portal Issue reported by ${userId}`,
                description: `User: ${userId}\nIssue: ${description}\n\n--- System Notes ---\n${aiNote}`,
                urgency: ticketUrgency
            }
        });

        // 4. Send the successful ticket number back to the frontend
        res.status(201).json({ 
            message: 'Ticket created successfully!', 
            ticketNumber: snResponse.data.result.number,
            aiUrgency: ticketUrgency === "1" ? "High" : "Normal"
        });

    } catch (error) {
        console.error("Ticket Creation Error:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to process and create ticket.' });
    }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});