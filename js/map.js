import { ref, push, update, remove, get } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { db } from './firebaseConfig.js';
import { MAPBOX_API_KEY } from './config.js';

// Initialize Mapbox
mapboxgl.accessToken = MAPBOX_API_KEY;

const categories = [
    "All", "Healthcare", "Banks", "Public Services", "Food", "Retail", 
    "Beauty", "Fitness", "Entertainment", "Education", "Accommodation", 
    "Pet Care", "Child Care"
];

let currentCategory = "All";

$(document).ready(function() {
    // Initialize the Mapbox map
    const map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/standard',
        center: [139.75505491681847, 35.68623110640659],
        zoom: 15,
        pitch: 60,
        bearing: -17.6,
        antialias: true,
        pitchWithRotate: true,
        dragRotate: true,
        language: 'en'
    });

    // Add navigation control
    map.addControl(new mapboxgl.NavigationControl());

    // Add the geocoder control to the map
    const geocoder = new MapboxGeocoder({
        accessToken: MAPBOX_API_KEY,
        mapboxgl: mapboxgl,
        placeholder: 'Search for a place',
        marker: false // We'll add our own marker
    });

    document.getElementById('geocoder').appendChild(geocoder.onAdd(map));

    // Add a marker for search results
    const marker = new mapboxgl.Marker({
        color: "#FFFFFF",
        draggable: false
    }).setLngLat([0, 0]).addTo(map);

    // Listen for the 'result' event from the geocoder
    geocoder.on('result', function(e) {
        const coords = e.result.center;
        marker.setLngLat(coords);
        map.flyTo({
            center: coords,
            zoom: 15
        });
    });

    // Modify this part
    map.on('load', () => {
        map.on('style.load', () => {
            add3DBuildingsLayer(map);
        });
        loadMarkersFromFirebase(map);
    });

    // Create category buttons
    createCategoryButtons(map);

    // Handle map click and open modal
    map.on('click', (e) => {
        // Check if a marker was clicked
        if (e.originalEvent.target.closest('.mapboxgl-marker')) {
            return; // Exit the function if a marker was clicked
        }

        const lat = e.lngLat.lat;
        const lon = e.lngLat.lng;

        // Reset form fields
        $('#locationForm')[0].reset();
        $('#location-name').val('');  // Set to empty string instead of 'Unknown'
        $('#lat').val(lat);
        $('#lon').val(lon);

        // Use reverse geocoding to get the place name
        fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?access_token=${MAPBOX_API_KEY}`)
            .then(response => response.json())
            .then(data => {
                const address = data.features[0]?.place_name || 'Unknown location';
                $('#address').val(address);
            });

        $('#map-modal').removeClass('hidden');
        $('#send').text('Add Location');
        $('#locationForm').data('mode', 'add');
        $('#locationForm').data('key', '');
    });

    // Handle modal close
    $('#cancelButton').on('click', () => {
        $('#map-modal').addClass('hidden');
    });

    // Submit form data
    $('#locationForm').on('submit', (e) => {
        e.preventDefault();

        const mode = $('#locationForm').data('mode');
        const key = $('#locationForm').data('key');

        const locationData = {
            name: $('#location-name').val() || 'Unknown',  // Use 'Unknown' if empty
            address: $('#address').val(),
            lat: $('#lat').val(),
            lon: $('#lon').val(),
            description: $('#description').val(),
            review: $('#review').val(),
            photo: $('#photo').val(),
            website: $('#website').val(),
            category: $('#category').val() || 'NA'
        };

        const locationsRef = ref(db, "locations");

        if (mode === 'add') {
            push(locationsRef, locationData)
                .then(() => {
                    console.log("Entry added successfully!");
                    $("#locationForm")[0].reset();
                    $("#map-modal").addClass("hidden");
                    loadMarkersFromFirebase(map);
                })
                .catch((error) => {
                    console.error("Error adding entry: ", error);
                });
        } else if (mode === 'edit') {
            update(ref(db, `locations/${key}`), locationData)
                .then(() => {
                    console.log("Entry updated successfully!");
                    $("#locationForm")[0].reset();
                    $("#map-modal").addClass("hidden");
                    loadMarkersFromFirebase(map);
                })
                .catch((error) => {
                    console.error("Error updating entry: ", error);
                });
        }
    });

    // Wait for the map style to load before setting up the language switcher
    map.on('style.load', () => {
        // Language Switcher
        $('#language-switcher').on('change', function() {
            const selectedLanguage = $(this).val();
            console.log('Language changed to:', selectedLanguage); // Debug log

            try {
                map.setLanguage(selectedLanguage);
                console.log('Language set successfully');
                
                // Remove the separate language indicator if it exists
                $('#language-indicator').remove();
            } catch (error) {
                console.error('Error setting language:', error);
            }

            // Force a re-render of the map
            map.style.sourceCaches['composite'].clearTiles();
            map.triggerRepaint();
        });
    });
});

function createCategoryButtons(map) {
    const buttonContainer = $('#category-buttons');
    categories.forEach(category => {
        const button = $('<button>')
            .addClass('category-button')
            .text(category)
            .on('click', function() {
                $('.category-button').removeClass('active');
                $(this).addClass('active');
                currentCategory = category;
                filterMarkersByCategory(map, category);
            });
        if (category === "All") {
            button.addClass('active');
        }
        buttonContainer.append(button);
    });
}

function filterMarkersByCategory(map, category) {
    map.markers.forEach(marker => {
        const markerCategory = marker.getElement().dataset.category;
        if (category === "All" || markerCategory === category) {
            marker.getElement().style.display = 'block';
        } else {
            marker.getElement().style.display = 'none';
        }
    });
}

function loadMarkersFromFirebase(map) {
    console.log("Loading markers from Firebase...");
    const locationsRef = ref(db, "locations");
    get(locationsRef).then((snapshot) => {
        console.log("Received data from Firebase:", snapshot.val());
        
        if (!snapshot.exists()) {
            console.log("No data available in Firebase");
            return;
        }

        // Remove existing markers
        if (map.markers) {
            map.markers.forEach(marker => marker.remove());
        }
        map.markers = [];

        snapshot.forEach((childSnapshot) => {
            const location = childSnapshot.val();
            location.key = childSnapshot.key;
            
            console.log("Processing location:", location);

            if (!location.lon || !location.lat) {
                console.error("Invalid coordinates for location:", location);
                return;
            }

            addMarkerToMap(map, location);
        });

        // Initial filtering
        filterMarkersByCategory(map, currentCategory);
    }).catch((error) => {
        console.error("Error fetching data from Firebase:", error);
    });
}

function addMarkerToMap(map, location) {
    console.log("Adding marker for location:", location);

    // Create custom marker element
    const el = document.createElement('div');
    el.className = 'custom-marker';
    el.dataset.category = location.category || 'NA';
    
    // Use the photo path from Firebase
    if (location.photo) {
        el.style.backgroundImage = `url('./img/${location.photo}')`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
    } else {
        // Fallback to SVG if no photo is available
        el.innerHTML = `
            <svg width="50" height="50" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                <circle cx="50" cy="50" r="40" fill="#FF4500" />
                <circle cx="50" cy="50" r="30" fill="#FFA500" />
                <text x="50" y="60" font-size="30" text-anchor="middle" fill="white">M</text>
            </svg>
        `;
    }

    // Create and add the marker to the map
    try {
        const marker = new mapboxgl.Marker({element: el, anchor: 'bottom'})
            .setLngLat([parseFloat(location.lon), parseFloat(location.lat)])
            .addTo(map);
        console.log("Marker added successfully:", marker.getLngLat());
        map.markers.push(marker);

        // Add click event to the marker
        el.addEventListener('click', () => {
            console.log("Marker clicked, location data:", location);
            
            // Populate all fields with data from Firebase
            $('#location-name').val(location.name || '');  // Use an empty string as fallback
            $('#address').val(location.address || '');
            $('#lat').val(location.lat || '');
            $('#lon').val(location.lon || '');
            $('#description').val(location.description || '');
            $('#review').val(location.review || '');
            $('#photo').val(location.photo || '');
            $('#website').val(location.website || '');
            $('#category').val(location.category || 'NA');
            
            // Log the values after setting them
            console.log("Modal fields populated:", {
                name: $('#location-name').val(),
                address: $('#address').val(),
                lat: $('#lat').val(),
                lon: $('#lon').val(),
                description: $('#description').val(),
                review: $('#review').val(),
                photo: $('#photo').val(),
                website: $('#website').val(),
                category: $('#category').val()
            });

            $('#map-modal').removeClass('hidden');
            $('#send').text('Update Location');
            $('#locationForm').data('mode', 'edit');
            $('#locationForm').data('key', location.key);
        });
    } catch (error) {
        console.error("Error adding marker:", error);
    }
}

// Add this new function
function add3DBuildingsLayer(map) {
    if (!map.getSource('composite')) {
        console.error('Composite source not found');
        return;
    }

    // Check if the 3D buildings layer already exists
    if (map.getLayer('add-3d-buildings')) {
        console.log('3D buildings layer already exists');
        return;
    }

    map.addLayer(
        {
            'id': 'add-3d-buildings',
            'source': 'composite',
            'source-layer': 'building',
            'filter': ['==', 'extrude', 'true'],
            'type': 'fill-extrusion',
            'minzoom': 15,
            'paint': {
                'fill-extrusion-color': '#aaa',
                'fill-extrusion-height': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    15,
                    0,
                    15.05,
                    ['get', 'height']
                ],
                'fill-extrusion-base': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    15,
                    0,
                    15.05,
                    ['get', 'min_height']
                ],
                'fill-extrusion-opacity': 0.6
            }
        }
    );
    console.log('3D buildings layer added successfully');
}
