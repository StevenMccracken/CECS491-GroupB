/* Service */


var exports = module.exports = {};


exports.getCloseDropps = function(dropps, user_location, max_distance){

	console.log("get close dropp");
	var closeDropps = {};

	// Loop over all the dropps in the JSON
	for( var dropp in dropps){
		var info = dropps[dropp]; // dropp is the key (ex. '-Ksadflkjl3d')
		var dropp_location = info["location"].split(",").map(Number); // Get string lat/long coords into number array
		var distance = dist(user_location, dropp_location); // Calculate straight-path distance between the points

		if(distance <= max_distance){
			closeDropps[dropps] = info; // Save the dropp to the return set if it's close enough
		} 
	}

	return closeDropps
}



// Haversine function to calculate the distance between two GPS coordinates
function dist(loc1, loc2) {
    var radians = (degrees) => { return degrees * Math.PI / 180; };

    var r = 6371e3; // meters
    var lat1 = loc1[0], lat2 = loc2[0];
    var lon1 = loc1[1], lon2 = loc2[1];

    var dLat = radians(lat2 - lat1);
    var dLon = radians(lon2 - lon1);
    var lat1 = radians(lat1)
    var lat2 = radians(lat2);

    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return r * c; // distance
}