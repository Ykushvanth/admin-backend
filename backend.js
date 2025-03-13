const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();
require('cross-fetch/polyfill');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Updated Supabase configuration with correct URL format and service role key
const supabaseUrl = 'https://xseoauyhebklccbhiawp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzZW9hdXloZWJrbGNjYmhpYXdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk0NjkwNjAsImV4cCI6MjA1NTA0NTA2MH0.G-0vB7u33qIozLu2Fc1h3g0P2X2Q69W0PTtc8hHLv00'; // Ensure this is correct

// Initialize Supabase with additional options
const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false
    },
    db: {
        schema: 'public'
    }
});

// JWT secret key
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Middleware to verify admin token
const verifyAdminToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.adminId = decoded.adminId;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// Simple test endpoint to verify database connection
app.get('/api/test', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('parking_locations')
            .select('location_id')
            .limit(1);

        if (error) {
            console.error('Test query error:', error);
            return res.status(500).json({ error: error.message });
        }

        res.json({ success: true, message: 'Database connection successful', data });
    } catch (error) {
        console.error('Test error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Updated login route with simplified query and better error handling
app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log('Login attempt for:', username);

        // Basic validation
        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Username and password are required' 
            });
        }

        // Simplified query
        const { data, error } = await supabase
            .from('parking_locations')
            .select('location_id, user_name, password, parking_lot_name')
            .eq('user_name', username)
            .single();

        // Log the response for debugging
        console.log('Query response:', { 
            hasData: !!data, 
            hasError: !!error,
            errorMessage: error?.message 
        });

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(401).json({ 
                    success: false, 
                    error: 'Invalid username or password' 
                });
            }
            throw error;
        }

        if (!data) {
            return res.status(401).json({ 
                success: false, 
                error: 'User not found' 
            });
        }

        // Password check
        if (password !== data.password) {
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid password' 
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            {
                adminId: data.location_id,
                username: data.user_name
            },
            'your-secret-key', // Replace with a secure secret key
            { expiresIn: '24h' }
        );

        // Success response
        res.json({
            success: true,
            token,
            adminDetails: {
                id: data.location_id,
                username: data.user_name,
                parkingLotName: data.parking_lot_name
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error', 
            details: error.message 
        });
    }
});

// Get Admin Profile
app.get('/api/admin/profile', verifyAdminToken, async (req, res) => {
    try {
        const { data: admin, error } = await supabase
            .from('parking_locations')
            .select('id, user_name')
            .eq('id', req.adminId)
            .single();

        if (error || !admin) {
            return res.status(404).json({ error: 'Admin not found' });
        }

        res.json({
            id: admin.id,
            username: admin.user_name
        });

    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get Dashboard Statistics for a specific admin
app.get('/api/admin/stats', verifyAdminToken, async (req, res) => {
    try {
        // Fetch admin details using the adminId from the token
        const { data: adminData, error: adminError } = await supabase
            .from('parking_locations')
            .select('location_id, user_name, password')
            .eq('location_id', req.adminId)
            .single();

        if (adminError || !adminData) {
            return res.status(404).json({ error: 'Admin not found' });
        }

        // Get total bookings for this admin's location
        const { count: totalBookings } = await supabase
            .from('slot_booking')
            .select('*', { count: 'exact' })
            .eq('parking_lot_location', adminData.location_id);

        // Get total revenue for this admin's location
        const { data: bookings } = await supabase
            .from('slot_booking')
            .select('amount_paid')
            .eq('parking_lot_location', adminData.location_id)
            .not('amount_paid', 'is', null);

        const totalRevenue = bookings.reduce((sum, booking) => sum + (booking.amount_paid || 0), 0);

        // Get available slots for this admin's location
        const { data: parkingLot } = await supabase
            .from('parking_locations')
            .select('available_slots')
            .eq('location_id', adminData.location_id)
            .single();

        const availableSlots = parkingLot ? parkingLot.available_slots : 0;

        // Get total users (assuming users are linked to bookings)
        const { count: totalUsers } = await supabase
            .from('slot_booking')
            .select('user_id', { count: 'exact' })
            .eq('parking_lot_location', adminData.location_id);

        res.json({
            totalBookings: totalBookings || 0,
            totalUsers: totalUsers || 0,
            totalRevenue: totalRevenue || 0,
            availableSlots: availableSlots || 0
        });

    } catch (error) {
        console.error('Stats fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get Bookings for Admin's Parking Lot
app.get('/api/admin/bookings', verifyAdminToken, async (req, res) => {
    try {
        // Fetch admin's parking lot location
        const { data: adminData, error: adminError } = await supabase
            .from('parking_locations')
            .select('location_id')
            .eq('location_id', req.adminId)
            .single();

        if (adminError || !adminData) {
            return res.status(404).json({ error: 'Admin not found' });
        }

        // Fetch bookings for this admin's parking lot
        const { data: bookings, error: bookingsError } = await supabase
            .from('slot_booking')
            .select('booking_id, user_id, slot_number, booked_date, car_number, actual_arrival_time, actual_departed_time, amount_paid')
            .eq('parking_lot_location', adminData.location_id);

        if (bookingsError) {
            throw bookingsError;
        }

        res.json(bookings);

    } catch (error) {
        console.error('Bookings fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update Parking Lot Details
app.put('/api/admin/parking-lot', verifyAdminToken, async (req, res) => {
    try {
        const { 
            parking_lot_name,
            address,
            state,
            district,
            area,
            contact_number,
            url,
            total_slots, 
            available_slots,
            price_per_hour,
            opening_time,
            closing_time,
            latitude,
            longitude,
            is_active,
            user_name,
            password
        } = req.body;

        // Validate input
        if (total_slots < 0 || available_slots < 0 || available_slots > total_slots) {
            return res.status(400).json({ 
                error: 'Invalid slot values. Available slots cannot exceed total slots and neither can be negative.' 
            });
        }

        // Create update object
        const updateData = {
            parking_lot_name,
            address,
            state,
            district,
            area,
            contact_number,
            url,
            total_slots,
            available_slots,
            price_per_hour,
            opening_time,
            closing_time,
            latitude,
            longitude,
            is_active,
            user_name
        };

        // Only include password if it was provided (not empty)
        if (password) {
            // In a real application, you would hash the password here
            updateData.password = password;
        }

        // Update parking lot details
        const { data, error } = await supabase
            .from('parking_locations')
            .update(updateData)
            .eq('location_id', req.adminId)
            .select();

        if (error) {
            throw error;
        }

        res.json(data[0]);
    } catch (error) {
        console.error('Error updating parking lot:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add this test endpoint to verify the schema and data
app.get('/api/verify-schema', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('parking_locations')
            .select(`
                location_id,
                parking_lot_name,
                total_slots,
                available_slots,
                price_per_hour,
                opening_time,
                closing_time,
                is_active,
                created_at,
                latitude,
                longitude,
                state,
                district,
                area,
                contact_number,
                address,
                user_name,
                password,
                url
            `)
            .limit(5);

        if (error) {
            console.error('Schema verification error:', error);
            return res.status(500).json({ error: error.message });
        }

        console.log('Sample data:', data);
        res.json({ success: true, data });

    } catch (error) {
        console.error('Schema verification failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add a test endpoint to check specific user
app.get('/api/check-user/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const { data, error } = await supabase
            .from('parking_locations')
            .select('user_name, parking_lot_name')
            .eq('user_name', username)
            .maybeSingle();

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json({
            exists: !!data,
            data: data ? {
                username: data.user_name,
                parkingLotName: data.parking_lot_name
            } : null
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add this endpoint to list all parking locations with usernames
app.get('/api/list-admins', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('parking_locations')
            .select(`
                location_id,
                parking_lot_name,
                user_name,
                state,
                district,
                area
            `)
            .not('user_name', 'is', null)
            .order('location_id');

        if (error) {
            throw error;
        }

        res.json({
            success: true,
            count: data.length,
            admins: data
        });

    } catch (error) {
        console.error('Error listing admins:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create a new booking
app.post('/api/admin/bookings', verifyAdminToken, async (req, res) => {
    const { slot_number, user_id, booked_date, parking_lot_location } = req.body;

    try {
        // Start a transaction
        const { data: booking, error: bookingError } = await supabase
            .from('slot_booking')
            .insert([{ slot_number, user_id, booked_date, parking_lot_location }])
            .single();

        if (bookingError) {
            throw bookingError;
        }

        // Decrease available slots
        const { data: updatedParkingLot, error: updateError } = await supabase
            .from('parking_locations')
            .update({ available_slots: supabase.raw('available_slots - 1') })
            .eq('location_id', parking_lot_location)
            .single();

        if (updateError) {
            throw updateError;
        }

        res.json({ success: true, booking, updatedParkingLot });

    } catch (error) {
        console.error('Booking creation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update booking on departure
app.post('/api/admin/bookings/departure', verifyAdminToken, async (req, res) => {
    const { booking_id, parking_lot_location } = req.body;

    try {
        // Update the booking to mark as departed
        const { data: booking, error: bookingError } = await supabase
            .from('slot_booking')
            .update({ actual_departed_time: new Date() })
            .eq('booking_id', booking_id)
            .single();

        if (bookingError) {
            throw bookingError;
        }

        // Increase available slots
        const { data: updatedParkingLot, error: updateError } = await supabase
            .from('parking_locations')
            .update({ available_slots: supabase.raw('available_slots + 1') })
            .eq('location_id', parking_lot_location)
            .single();

        if (updateError) {
            throw updateError;
        }

        res.json({ success: true, booking, updatedParkingLot });

    } catch (error) {
        console.error('Departure update error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update Booking Details for Admin's Parking Lot
app.put('/api/admin/bookings/:bookingId', verifyAdminToken, async (req, res) => {
    const { bookingId } = req.params;
    const updates = req.body;

    try {
        // Ensure the booking belongs to the admin's parking lot
        const { data: booking, error: bookingError } = await supabase
            .from('slot_booking')
            .select('parking_lot_location')
            .eq('booking_id', bookingId)
            .single();

        if (bookingError || !booking || booking.parking_lot_location !== req.adminId) {
            return res.status(403).json({ error: 'Unauthorized access' });
        }

        // Update the booking details
        const { data, error } = await supabase
            .from('slot_booking')
            .update(updates)
            .eq('booking_id', bookingId)
            .single();

        if (error) {
            throw error;
        }

        res.json(data);

    } catch (error) {
        console.error('Booking update error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get User Details for Admin's Parking Lot
app.get('/api/admin/users', verifyAdminToken, async (req, res) => {
    try {
        // Fetch admin's parking lot location
        const { data: adminData, error: adminError } = await supabase
            .from('parking_locations')
            .select('location_id')
            .eq('location_id', req.adminId)
            .single();

        if (adminError || !adminData) {
            return res.status(404).json({ error: 'Admin not found' });
        }

        // Fetch booking details including driver name and booking ID
        const { data: bookings, error: bookingsError } = await supabase
            .from('slot_booking')
            .select('user_id, booking_id, driver_name')
            .eq('parking_lot_location', adminData.location_id);

        if (bookingsError) {
            throw bookingsError;
        }

        // Extract unique user IDs
        const userIds = [...new Set(bookings.map(booking => booking.user_id))];

        // Fetch user details from users table
        const { data: userDetails, error: userDetailsError } = await supabase
            .from('users')
            .select('id, first_name, last_name, email, aadhar_number, phone_number')
            .in('id', userIds);

        if (userDetailsError) {
            throw userDetailsError;
        }

        // Merge user details with booking details
        const usersWithDetails = userDetails.map(user => {
            const booking = bookings.find(b => b.user_id === user.id);
            return {
                ...user,
                booking_id: booking?.booking_id,
                driver_name: booking?.driver_name
            };
        });

        res.json(usersWithDetails);

    } catch (error) {
        console.error('Users fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get Parking Lot Details for Admin
app.get('/api/admin/parking-lot', verifyAdminToken, async (req, res) => {
    try {
        // Fetch parking lot details using the admin's ID (which should match location_id)
        const { data, error } = await supabase
            .from('parking_locations')
            .select('*')
            .eq('location_id', req.adminId)
            .single();

        if (error) {
            console.error('Error fetching parking lot:', error);
            return res.status(404).json({ error: 'Parking lot not found' });
        }

        res.json(data);
    } catch (error) {
        console.error('Error fetching parking lot details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create Parking Lot for Admin
app.post('/api/admin/parking-lot', verifyAdminToken, async (req, res) => {
    try {
        const { 
            parking_lot_name,
            address,
            state,
            district,
            area,
            contact_number,
            url,
            total_slots, 
            available_slots,
            price_per_hour,
            opening_time,
            closing_time,
            latitude,
            longitude,
            is_active,
            user_name,
            password
        } = req.body;

        // Validate input
        if (!parking_lot_name || !address || !state || !district || !area) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (total_slots < 0 || available_slots < 0 || available_slots > total_slots) {
            return res.status(400).json({ 
                error: 'Invalid slot values. Available slots cannot exceed total slots and neither can be negative.' 
            });
        }

        // Create new parking lot
        const { data, error } = await supabase
            .from('parking_locations')
            .insert([
                {
                    location_id: req.adminId, // Use admin ID as location ID
                    parking_lot_name,
                    address,
                    state,
                    district,
                    area,
                    contact_number,
                    url,
                    total_slots,
                    available_slots,
                    price_per_hour,
                    opening_time,
                    closing_time,
                    latitude,
                    longitude,
                    is_active,
                    user_name,
                    password
                }
            ])
            .select()
            .single();

        if (error) {
            console.error('Error creating parking lot:', error);
            return res.status(500).json({ error: 'Failed to create parking lot' });
        }

        res.status(201).json(data);
    } catch (error) {
        console.error('Error creating parking lot:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    
    // Test database connection on startup
    supabase
        .from('parking_locations')
        .select('location_id')
        .limit(1)
        .then(({ data, error }) => {
            if (error) {
                console.error('Initial database connection failed:', error);
            } else {
                console.log('Initial database connection successful');
            }
        });
});
