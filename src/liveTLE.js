// liveTLE.js

export async function fetchLiveTLEs() {
    try {

        const response = await fetch(
            'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle'
        );

        const text = await response.text();

        const lines = text.trim().split('\n');

        const satellites = [];

        for (let i = 0; i < lines.length; i += 3) {

            satellites.push({
                name: lines[i].trim(),
                line1: lines[i + 1].trim(),
                line2: lines[i + 2].trim()
            });

        }

        return satellites;

    } catch (error) {

        console.error('Error fetching live TLE data:', error);
        return [];

    }
}