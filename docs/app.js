var config = {
        apiKey: "AIzaSyCsN8GMxxwOpvzM-7yTK47yi1zWOq2rVkw",
        authDomain: "santa-walk-identification.firebaseapp.com",
        databaseURL: "https://santa-walk-identification.firebaseio.com",
        projectId: "santa-walk-identification",
        storageBucket: "santa-walk-identification.appspot.com"
      };

firebase.initializeApp(config);

var app = new Vue({
  el: '#app',
  data: {
    scans: [],
    db: null,
  },
  mounted: function () {
    var self = this;

    self.db = firebase.firestore();
    const settings = {/* your settings... */ timestampsInSnapshots: true};
    self.db.settings(settings);
  },
});

/*Functionality for tabs*/
function openTab(evt, tabname) {
  var i, tabcontent, tablinks;

  // Get all elements with class="tabcontent" and hide them
  tabcontent = document.getElementsByClassName("tabcontent");
  for (i = 0; i < tabcontent.length; i++) {
    tabcontent[i].style.display = "none";
  }

  // Get all elements with class="tablinks" and remove the class "active"
  tablinks = document.getElementsByClassName("tablinks");
  for (i = 0; i < tablinks.length; i++) {
    tablinks[i].className = tablinks[i].className.replace(" active", "");
  }

  // Show the current tab, and add an "active" class to the button that opened the tab
  document.getElementById(tabname).style.display = "block";
  evt.currentTarget.className += " active";

  if (tabname == 'Count') {
    Count()
  } else if (tabname == 'Winner')
    Winner()
}

function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function Winner() {
  var db, santaWalkRef, santaWalkDocs, tmp, arr

  db = firebase.firestore();
  const settings = {/* your settings... */ timestampsInSnapshots: true};
  db.settings(settings);
  arr = [];
  count = 0;

  santaWalkRef = db.collection('santa_walk_2022');

  santaWalkDocs = await santaWalkRef.get()
  .then(snapshot => {
      snapshot.forEach(doc => {
        arr.push([doc.id, doc.data()]);
        arr.lenght++;
      });
    })
  .catch(err => {
    console.log('Error getting documents', err);
  });

  // Generate random number
  tmp = getRandomInt(0, arr.length)
  console.log("Random number", arr[tmp])
  document.getElementById('winner').innerHTML = arr[tmp][1].ID;
}

async function Count() {
  var db, santaWalkRef, santaWalkDocs, count

  db = firebase.firestore();
  const settings = {/* your settings... */ timestampsInSnapshots: true};
  db.settings(settings);
  count = 0;

  santaWalkRef = db.collection('santa_walk_2022');

  santaWalkDocs = await santaWalkRef.get()
  .then(snapshot => {
    snapshot.forEach(doc => {
      ++count;
    });
  })
  .catch(err => {
    console.log('Error getting documents', err);
  });
  document.getElementById('totalCount').innerHTML = count;
}
