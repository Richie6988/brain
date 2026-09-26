function administration() {
    // Create buttons
    const statsButton = document.createElement("button");
    statsButton.id = 'statsButton';
    statsButton.classList.add('menuBtn');
    statsButton.onclick = () => openPopup("users-dashboard");

    const usersButton = document.createElement("button");
    usersButton.id = 'usersButton';
    usersButton.classList.add('menuBtn');
    usersButton.onclick = () => openPopup("userPopup");

    document.getElementById('button-container').appendChild(statsButton);
    document.getElementById('button-container').appendChild(usersButton);

    setTimeout(() => {
        createTooltip('statsButton','Nod-Z Data')
        createTooltip('usersButton','Nod-Z Users')
    }, 100);


    // Create overlay
    const overlay = document.createElement("div");
    overlay.id = "admin-overlay";
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); display: none; z-index: 999;
    `;
    document.body.appendChild(overlay);

    // Create popups dynamically
    createPopup("overviewPopup", "📊 App Overview", `
        <canvas id="userChart" width="400" height="200"></canvas>
    `);

    createPopup("userPopup", "🧑‍💻 Users", `
        <style>
            .filter-container {
                display: flex;
                flex-wrap: wrap;
                gap: 10px;
                margin-bottom: 10px;
            }
            .filter-container select,
            .filter-container input {
                padding: 8px;
                font-size: 14px;
                border: 1px solid #ccc;
                border-radius: 5px;
            }
            .user-counter {
                font-size: 16px;
                font-weight: bold;
                margin-bottom: 10px;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 10px;
            }
            th, td {
                padding: 10px;
                border: 1px solid #ddd;
                text-align: center; 
            }
            th {
                background-color: #f4f4f4;
            }
            tbody tr:nth-child(even) {
                background-color: #f9f9f9;
            }
        </style>

        <div class="filter-container">
            <!-- Keyword Search -->
            <input type="text" id="keywordFilter" placeholder="Search username or email..." onkeyup="filterUsers()">
            
            <!-- Date Filter -->
            <select id="dateTypeFilter" onchange="toggleDateInputs()">
                <option value="">Join Date</option>
                <option value="before">Before</option>
                <option value="after">After</option>
                <option value="between">Between</option>
            </select>
            <input type="date" id="dateFilterStart" onchange="filterUsers()" style="display:none;">
            <input type="date" id="dateFilterEnd" onchange="filterUsers()" style="display:none;">

            <!-- Premium Filter -->
            <select id="premiumFilter" onchange="filterUsers()">
                <option value="">Premium</option>
                <option value="false">false</option>
                <option value="true">true</option>
            </select>

            <!-- Multi-Select Country Filter -->
            <select id="countryFilter" multiple onchange="filterUsers()">
                <!-- Dynamically populated -->
            </select>

            <p>Selected Countries: <span id="displaySelected"></span></p>

            <!-- Nodes Counter Filter -->
            <select id="nodesOrder" onchange="sortTable('nodescounter')">
                <option value="">Sort Nodes</option>
                <option value="asc">Lowest First</option>
                <option value="desc">Highest First</option>
            </select>
            <input type="number" id="nodesMin" placeholder="Min Nodes" oninput="filterUsers()">
            <input type="number" id="nodesMax" placeholder="Max Nodes" oninput="filterUsers()">

            <!-- Referree Points Filter -->
            <select id="refOrder" onchange="sortTable('referree_points')">
                <option value="">Sort Referrees</option>
                <option value="asc">Lowest First</option>
                <option value="desc">Highest First</option>
            </select>
            <input type="number" id="refMin" placeholder="Min Referrees" oninput="filterUsers()">
            <input type="number" id="refMax" placeholder="Max Referrees" oninput="filterUsers()">

            <button class="submit-button" onclick="resetFilters()">Reset Filters</button>
        </div>

        <div class="user-counter">Users Found: <span id="userCount">0</span></div>
        <div id="userCard" class="user-card" style="display:none;"></div>

        <div style="max-height: 400px; overflow-y: auto; border: 1px solid #ccc;">
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Country</th>
                        <th>Email</th>
                        <th>Join Date</th>
                        <th>Premium</th>
                        <th>Nodes</th>
                        <th>Referrees</th>
                    </tr>
                </thead>
                <tbody id="userTable"></tbody>
            </table>
        </div>
    `);
    
    getUsers();



    // Function to populate the dropdown
    // function populateCountryFilter() {
    //     const countrySelect = document.getElementById("countryFilter");
        
    //     countries.forEach(country => {
    //         let option = document.createElement("option");
    //         option.value = country;
    //         option.textContent = country;
    //         countrySelect.appendChild(option);
    //     });
    // }
    // populateCountryFilter();
}



// function toggleDateInputs() {
//     const type = document.getElementById("dateTypeFilter").value;
//     document.getElementById("dateFilterStart").style.display = (type === "before" || type === "after" || type === "between") ? "" : "none";
//     document.getElementById("dateFilterEnd").style.display = (type === "between") ? "" : "none";
// }

// function resetFilters() {
//     document.getElementById("keywordFilter").value = "";
//     document.getElementById("premiumFilter").value = "";
//     document.getElementById("countryFilter").value = "";
//     selectedCountries = [];
//     document.getElementById("dateTypeFilter").value = "";
//     document.getElementById("dateFilterStart").value = "";
//     document.getElementById("dateFilterEnd").value = "";
//     document.getElementById("nodesOrder").value = "";
//     document.getElementById("nodesMin").value = "";
//     document.getElementById("nodesMax").value = "";
//     document.getElementById("refOrder").value = "";
//     document.getElementById("refMin").value = "";
//     document.getElementById("refMax").value = "";
//     filterUsers();
// }

// function sortTable(columnName) {
//     const table = document.getElementById("userTable");
//     const rows = Array.from(table.rows);
//     const order = document.getElementById(columnName === "nodescounter" ? "nodesOrder" : "refOrder").value;

//     rows.sort((rowA, rowB) => {
//         const valA = parseInt(rowA.cells[columnName === "nodescounter" ? 5 : 6].textContent) || 0;
//         const valB = parseInt(rowB.cells[columnName === "nodescounter" ? 5 : 6].textContent) || 0;
//         return order === "asc" ? valA - valB : valB - valA;
//     });

//     rows.forEach(row => table.appendChild(row)); // Reorder rows in table
// }

function getUsers() {    
    const csrfToken = getCookie('csrftoken');
    fetch('/admin-users/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken,
        },
    }).then(response => {
        if (!response.ok) {
            if (response.status === 403) {  
                alert("Access denied. Logging out...");
                window.location.href = '/logout/'; 
            }
            throw new Error('Network response was not ok');
        } 
        return response.json(); 
    }).then(data => {  
        const userTable = document.getElementById("userTable");
        data.users.forEach(user => {
            const row = document.createElement("tr");
            var premium = user.premium ? '<span class="premium-badge">Premium</span>' : '';
            row.innerHTML = `<td>${user.username}</td><td>${user.country}</td><td>${user.email}</td><td>${user.date_joined}</td><td>${premium}</td><td>${user.cumulPremium}</td><td>${user.nodescounter}</td><td>${user.referree_points}</td>`;
            row.onclick = () => openUserCard(user);
            userTable.appendChild(row);
        });    
        // resetFilters();      
    }).catch(error => {
        console.error('There was a problem with loading users table:', error);
    });
}

// Create popup function
function createPopup(id, title, content) {
    const popup = document.createElement("div");
    popup.id = id;
    popup.className = "adminpopup";
    popup.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: white; padding: 20px; box-shadow: 0px 4px 10px rgba(0,0,0,0.2);
        display: none; z-index: 1000; overflow-y: auto; width: 88%; height: 92%; pointerEvents: auto;
    `;
    popup.innerHTML = `<span class="close-btn" style="height:10px" onclick="closePopup('${id}')">&times;</span>
        <h2>${title}</h2>${content}`;
    document.body.appendChild(popup);
}

// Open popup function
function openPopup(id) {
    overlay = true;
    document.getElementById(id).style.display = "block";
    // document.getElementById("admin-overlay").style.display = "block";
    // document.getElementById(id).scrollTop = 0; 
   
    // if (id === "overviewPopup") setTimeout(loadChart, 200);
    // if (id === "userPopup" && admin){
    //     admin = false;
    //     usersButton = document.getElementById('usersButton');
    //     usersButton.textContent = "🧑‍💻 Users";
    //     closePopup(id);
    //     load(0);        
    // }
}

// Close popup function
function closePopup(id) {
    console.log(id)
    document.getElementById(id).style.display = "none";
    // document.getElementById("admin-overlay").style.display = "none";
    overlay = false;
}

document.addEventListener('mousedown', function(event) {
    var user = document.getElementById('userPopup');
    var buttons = document.getElementById('button-container');
    var overview = document.getElementById('overviewPopup');
    if(buttons && !buttons.contains(event.target)){
        if(user && user.style.display === 'block' && !user.contains(event.target)){           
            closePopup('userPopup');
        } else if (overview && overview.style.display === 'block' && !overview.contains(event.target)) {
            closePopup('overviewPopup');
        }
    }
});


let userChart;
// Load Chart.js graph
function loadChart() {
    if (userChart) {
        userChart.destroy();  
    }
  
    const ctx = document.getElementById('userChart').getContext('2d');
    userChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Total Users', 'New (Week)', 'New (Month)', 'Premium', 'Revenue'],
            datasets: [{ label: 'App Stats', data: [1000, 50, 200, 300, 5000], backgroundColor: ['blue', 'green', 'purple', 'orange', 'red'] }]
        },
    });
}     



// Open user card function
function openUserCard(user) {
    const userCard = document.getElementById("userCard");
    userCard.innerHTML = `<h3>${user.id} ${user.username}</h3>
                          <p>Premium: ${user.premium}, Joined: ${user.date_joined}</p>
                          <button class="submit-button" onclick="loadUniverse('${user.id}')">🚀 Load Universe</button>`;
    userCard.style.display = "block";
}

// Load universe function
function loadUniverse(userID) {
    adminload(userID,1);
    closePopup('userPopup');
    usersButton = document.getElementById('usersButton');
    usersButton.textContent = "❌👀 Stop Watching";
}

function adminload(userID,layer){
    loadingSpinner.style.display = 'block';
    isLoading = true;
    selectedNodes.length = 0;
    players = [];
    currentNode = null;
    const csrfToken = getCookie('csrftoken');
    fetch('/admin-loading/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken,
        },
        body: JSON.stringify({userID: userID, layer: layer}), 
    }).then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return response.json();   
    }).then(data => {      
        rebootUniverse(); 
        if (data.layers) {
            layers.length = 0;
            let layerItems = Array.isArray(data.layers) ? data.layers : [data.layers]; // Wrap single object in an array
            layerItems .forEach(layer => {  
                layers.push({ id: layer.layerid, name: layer.layername });
            });  
        } if (data.params) {
            data.params.forEach(param => {    
                loadParams(param);
            });
        } if (data.user) {
            data.user.forEach(param => {   
                loadUser(param);
            });
        } if (data.nodes) {
            data.nodes.forEach(node => {    
                displayNode(node);
            });
        } if (data.links) {
            data.links.forEach(link => {    
                displayLink(link);               
            });
        } if (data.templates) {
            data.templates.forEach(template => {    
                displayTemplate(template);               
            });
        } if (data.notifications) {
            data.notifications.forEach(notification => {    
                const dateString = notification.notification; 
                // Convert to Date object
                const [day, month, yearAndTime] = dateString.split('-');
                const [year, time] = yearAndTime.split(' ');
                const [hours, minutes] = time.split(':');                        
                const notificationDate = new Date(year, month - 1, day, hours, minutes);
                notificationsDate.push([notificationDate,notification.layer,notification.node]);
                // Sort by the first element (date) in the sub-array
                notificationsDate.sort((a, b) => a[0] - b[0]);             
            });
            const notification = document.getElementById('notificationButton');
            notification.dataset.count = 0;
            // Dispatch custom event
            const event = new Event('countChange');
            notification.dispatchEvent(event);
        } 
        isLoading = false;   
        loadingSpinner.style.display = 'none'; 

        cancelList.length = 0;
        cancelIndex = 0;
        focusNode(closestNode());
   
       
        if(layerNumber === undefined && layer === 0){
            layer = 1;
        } else if (layer === 0){
            layer = layerNumber;
        }
        selectedLayer = layers.find(e => e.id === parseInt(layer, 10));
        layerNumber = layer;
        renderLayers();

        admin = true;
    })
    .catch(error => {
        console.error('There was a problem with the fetch operation:', error);
    });
}

