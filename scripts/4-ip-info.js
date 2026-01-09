// ==========================================
// 4-IP-INFO.JS - Public IP Display Module
// Anderson Homepage v2.2
//
// Features:
// - Dual API verification (ipify + ip-api)
// - Location information display
// - Auto-refresh every 5 minutes
// - Last checked timestamp
//
// Note: Using ip-api.com instead of ipapi.co
// because ipapi.co blocks file:// origins (CORS)
// ==========================================

const IPInfo = {
    // Configuration
    config: {
        refreshInterval: 5 * 60 * 1000, // 5 minutes in milliseconds
        pendingTimeout: 3000, // 3 seconds before "API pending" becomes "IP issue"
        ipifyUrl: 'https://api.ipify.org?format=json',
        // ip-api.com is free, has CORS support, and works with file:// origins
        // Note: Free tier is HTTP only (not HTTPS), but works well for local use
        ipapiUrl: 'http://ip-api.com/json/?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query'
    },

    // State
    state: {
        ipifyIP: null,
        ipapiIP: null,
        location: null,
        lastChecked: null,
        intervalId: null,
        pendingTimeoutId: null,
        fetchStartTime: null,
        ipifyError: false,
        ipapiError: false
    },

    // Initialize the module
    initialize() {
        console.log('[IPInfo] Initializing IP Info module...');
        this.createDisplayElement();
        this.fetchIPInfo();
        this.startAutoRefresh();
        this.startTimestampUpdater();
        console.log('[IPInfo] Module initialized');
    },

    // Create the display element in the header
    createDisplayElement() {
        const controls = document.querySelector('.controls');
        if (!controls) {
            console.error('[IPInfo] Controls element not found');
            return;
        }

        // Create IP info container
        const ipBox = document.createElement('div');
        ipBox.className = 'ip-info-box';
        ipBox.id = 'ipInfoBox';
        ipBox.innerHTML = `
            <div class="ip-row">
                <span class="ip-source">(Ipify)</span>
                <span class="ip-label">IP address:</span>
                <span class="ip-value" id="ipifyValue">Loading...</span>
            </div>
            <div class="ip-row">
                <span class="ip-source">(ip-api)</span>
                <span class="ip-label">IP address:</span>
                <span class="ip-value" id="ipapiValue">Loading...</span>
            </div>
            <div class="ip-row ip-location-row">
                <span class="ip-location" id="ipLocation">📍 Detecting...</span>
            </div>
            <div class="ip-row ip-status-row">
                <span class="ip-match-status pending" id="ipMatchStatus">API pending</span>
                <span class="ip-timestamp" id="ipTimestamp">(checking...)</span>
            </div>
        `;

        // Insert before the hamburger button
        const hamburgerBtn = document.getElementById('hamburgerBtn');
        if (hamburgerBtn) {
            controls.insertBefore(ipBox, hamburgerBtn);
        } else {
            controls.appendChild(ipBox);
        }

        console.log('[IPInfo] Display element created');
    },

    // Fetch IP from both APIs
    async fetchIPInfo() {
        console.log('[IPInfo] Fetching IP information...');

        // Reset state for new fetch
        this.state.ipifyIP = null;
        this.state.ipapiIP = null;
        this.state.location = null;
        this.state.ipifyError = false;
        this.state.ipapiError = false;
        this.state.fetchStartTime = Date.now();

        // Clear any existing pending timeout
        if (this.state.pendingTimeoutId) {
            clearTimeout(this.state.pendingTimeoutId);
        }

        // Update UI to show loading state
        this.setLoadingState();
        
        // Set initial pending status
        this.setStatusPending();

        // Start 3-second timeout - if APIs haven't returned by then, show "IP issue"
        this.state.pendingTimeoutId = setTimeout(() => {
            console.log('[IPInfo] Pending timeout reached (3s)');
            this.updateMatchStatus();
        }, this.config.pendingTimeout);

        // Fetch from both APIs concurrently
        const [ipifyResult, ipapiResult] = await Promise.allSettled([
            this.fetchFromIpify(),
            this.fetchFromIpapi()
        ]);

        // Clear the pending timeout since we got results
        if (this.state.pendingTimeoutId) {
            clearTimeout(this.state.pendingTimeoutId);
            this.state.pendingTimeoutId = null;
        }

        // Process ipify result
        if (ipifyResult.status === 'fulfilled') {
            this.state.ipifyIP = ipifyResult.value;
            document.getElementById('ipifyValue').textContent = ipifyResult.value;
            document.getElementById('ipifyValue').classList.remove('loading', 'error');
        } else {
            console.error('[IPInfo] Ipify fetch failed:', ipifyResult.reason);
            this.state.ipifyError = true;
            document.getElementById('ipifyValue').textContent = 'Error';
            document.getElementById('ipifyValue').classList.add('error');
            document.getElementById('ipifyValue').classList.remove('loading');
        }

        // Process ipapi result
        if (ipapiResult.status === 'fulfilled') {
            const data = ipapiResult.value;
            this.state.ipapiIP = data.ip;
            this.state.location = {
                city: data.city,
                region: data.region,
                country: data.country,
                org: data.org,
                asn: data.asn
            };

            document.getElementById('ipapiValue').textContent = data.ip;
            document.getElementById('ipapiValue').classList.remove('loading', 'error');

            // Update location display
            this.updateLocationDisplay();
        } else {
            console.error('[IPInfo] ip-api fetch failed:', ipapiResult.reason);
            this.state.ipapiError = true;
            document.getElementById('ipapiValue').textContent = 'Error';
            document.getElementById('ipapiValue').classList.add('error');
            document.getElementById('ipapiValue').classList.remove('loading');
            document.getElementById('ipLocation').textContent = '📍 Location unavailable';
        }

        // Update match status
        this.updateMatchStatus();

        // Update timestamp
        this.state.lastChecked = new Date();
        this.updateTimestamp();

        console.log('[IPInfo] IP fetch complete');
    },
    
    // Set status to pending (yellow, slow pulse)
    setStatusPending() {
        const statusEl = document.getElementById('ipMatchStatus');
        if (statusEl) {
            statusEl.textContent = 'API pending';
            statusEl.className = 'ip-match-status pending';
        }
    },

    // Fetch from ipify API
    async fetchFromIpify() {
        const response = await fetch(this.config.ipifyUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return data.ip;
    },

    // Fetch from ip-api.com API
    async fetchFromIpapi() {
        const response = await fetch(this.config.ipapiUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        // ip-api.com returns status: 'success' or 'fail'
        if (data.status === 'fail') throw new Error(data.message || 'API Error');
        // Normalize the response to match our expected format
        return {
            ip: data.query,  // ip-api uses 'query' for the IP
            city: data.city,
            region: data.regionName || data.region,
            country: data.countryCode,
            org: data.isp || data.org,
            asn: data.as
        };
    },

    // Set loading state for UI
    setLoadingState() {
        const ipifyEl = document.getElementById('ipifyValue');
        const ipapiEl = document.getElementById('ipapiValue');
        
        if (ipifyEl) {
            ipifyEl.textContent = 'Loading...';
            ipifyEl.classList.add('loading');
        }
        if (ipapiEl) {
            ipapiEl.textContent = 'Loading...';
            ipapiEl.classList.add('loading');
        }
    },

    // Update location display
    updateLocationDisplay() {
        const locationEl = document.getElementById('ipLocation');
        if (!locationEl || !this.state.location) return;

        const { city, region, country, org } = this.state.location;
        const parts = [city, region, country].filter(Boolean);
        const locationStr = parts.join(', ');
        
        // Get country flag emoji
        const flag = this.getCountryFlag(country);
        
        locationEl.textContent = `${flag} ${locationStr}`;
        locationEl.title = org || 'Unknown ISP';
    },

    // Get country flag emoji from country code
    getCountryFlag(countryCode) {
        if (!countryCode || countryCode.length !== 2) return '📍';
        
        const codePoints = countryCode
            .toUpperCase()
            .split('')
            .map(char => 127397 + char.charCodeAt(0));
        
        return String.fromCodePoint(...codePoints);
    },

    // Update IP match status indicator
    // States: "API pending" (yellow), "US IP, matched" (green), "IP issue" (red)
    updateMatchStatus() {
        const statusEl = document.getElementById('ipMatchStatus');
        if (!statusEl) return;

        const { ipifyIP, ipapiIP, location, ipifyError, ipapiError, fetchStartTime } = this.state;
        
        // Check elapsed time since fetch started
        const elapsedMs = fetchStartTime ? Date.now() - fetchStartTime : 0;
        const isPastTimeout = elapsedMs > this.config.pendingTimeout;
        
        // Check conditions
        const bothReturned = (ipifyIP || ipifyError) && (ipapiIP || ipapiError);
        const hasError = ipifyError || ipapiError;
        const isNonUS = location && location.country && location.country.toUpperCase() !== 'US';
        const isMismatch = ipifyIP && ipapiIP && ipifyIP !== ipapiIP;
        
        // Determine which state to show
        if (!bothReturned && !isPastTimeout) {
            // Still waiting, within 3 seconds - show pending
            statusEl.textContent = 'API pending';
            statusEl.className = 'ip-match-status pending';
            console.log('[IPInfo] Status: API pending');
        } else if (bothReturned && !hasError && !isNonUS && !isMismatch && ipifyIP === ipapiIP) {
            // All good: both returned, no errors, US location, IPs match
            statusEl.textContent = 'US IP, matched';
            statusEl.className = 'ip-match-status matched';
            console.log('[IPInfo] Status: US IP, matched');
        } else {
            // Issue detected: timeout, error, non-US, or mismatch
            statusEl.textContent = 'IP issue';
            statusEl.className = 'ip-match-status issue';
            
            // Log the reason
            const reasons = [];
            if (isPastTimeout && !bothReturned) reasons.push('API timeout');
            if (hasError) reasons.push('API error');
            if (isNonUS) reasons.push('Non-US location');
            if (isMismatch) reasons.push('IP mismatch');
            console.log('[IPInfo] Status: IP issue -', reasons.join(', '));
        }
    },

    // Update the timestamp display
    updateTimestamp() {
        const timestampEl = document.getElementById('ipTimestamp');
        if (!timestampEl || !this.state.lastChecked) return;

        const now = new Date();
        const diffMs = now - this.state.lastChecked;
        const diffMins = Math.floor(diffMs / 60000);
        const diffSecs = Math.floor((diffMs % 60000) / 1000);

        let timeStr;
        if (diffMins === 0) {
            if (diffSecs < 10) {
                timeStr = 'just now';
            } else {
                timeStr = `${diffSecs}s ago`;
            }
        } else if (diffMins === 1) {
            timeStr = '1 min ago';
        } else {
            timeStr = `${diffMins} min ago`;
        }

        timestampEl.textContent = `(last checked: ${timeStr})`;
    },

    // Start auto-refresh interval
    startAutoRefresh() {
        if (this.state.intervalId) {
            clearInterval(this.state.intervalId);
        }

        this.state.intervalId = setInterval(() => {
            console.log('[IPInfo] Auto-refreshing IP info...');
            this.fetchIPInfo();
        }, this.config.refreshInterval);

        console.log('[IPInfo] Auto-refresh started (every 5 minutes)');
    },

    // Start timestamp updater (updates every 10 seconds)
    startTimestampUpdater() {
        setInterval(() => {
            this.updateTimestamp();
        }, 10000); // Update every 10 seconds
    },

    // Manual refresh
    refresh() {
        console.log('[IPInfo] Manual refresh triggered');
        this.fetchIPInfo();
    },

    // Stop auto-refresh
    stop() {
        if (this.state.intervalId) {
            clearInterval(this.state.intervalId);
            this.state.intervalId = null;
            console.log('[IPInfo] Auto-refresh stopped');
        }
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Small delay to ensure other modules are loaded
    setTimeout(() => {
        IPInfo.initialize();
    }, 100);
});

// Expose to global scope
window.IPInfo = IPInfo;
