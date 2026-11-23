// The search box (#124). A "latitude, longitude" opens that point;
// anything else is searched as a place name (search.js) and the results are listed.
// It touches the page, so it is kept apart from search.js, which can be tested in Node.
// Used as globalThis.SearchBox in the browser.
(function (root) {
  'use strict';

  // form, input, list: the search box, its text field and the list of results.
  // searchPlaces: name → results (Search.create()). coordName: (lat, lon) → the name of a point.
  // errorMessage: the message for a failed search. choose: opens the chosen place.
  // Returns close() for selectPlace().
  function setup({ form, input, list, searchPlaces, t, coordName, errorMessage, choose }) {
    const { parseCoords } = root.Places;

    // Each search gets a number, so a late result from an earlier search does not overwrite the list.
    let searchSeq = 0;
    // The name being searched. Pressing search again with the same name does not send another
    // request (Nominatim allows one request per second, #82).
    let searchingName = null;

    const showMessage = (text) => {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = text;
      list.replaceChildren(li);
      list.hidden = false;
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name || name === searchingName) return;
      const coords = parseCoords(name);
      if (coords) {
        choose({ name: coordName(coords.lat, coords.lon), ...coords, named: false });
        return;
      }
      const seq = ++searchSeq;
      searchingName = name;
      showMessage(t('searching'));
      try {
        const results = await searchPlaces(name);
        if (seq !== searchSeq) return;
        if (!results.length) { showMessage(t('notFound')); return; }
        list.replaceChildren(...results.map((r) => {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = r.label;
          btn.addEventListener('click', () => {
            choose({ name: r.name, lat: r.lat, lon: r.lon, named: true });
          });
          li.append(btn);
          return li;
        }));
        list.hidden = false;
      } catch (err) {
        console.error(err);
        if (seq !== searchSeq) return;
        showMessage(errorMessage(err));
      } finally {
        if (seq === searchSeq) searchingName = null;
      }
    });

    return {
      // Close the list when a place is chosen in any way (a result, coordinates, the map, the URL), and
      // ignore a search still in progress, so its late result does not open the list again (#106).
      // The search box keeps its text.
      close() {
        ++searchSeq;
        searchingName = null;
        list.hidden = true;
      },
    };
  }

  root.SearchBox = { setup };
})(globalThis);
