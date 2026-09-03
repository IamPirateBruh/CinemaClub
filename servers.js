const SERVERS = {
    movie: [
        {
            id: "vidsrc",
            name: "VidSrc",
            template: "https://vidsrc.me/embed/movie?tmdb={tmdb-id}"
        },
        {
            id: "multiembed",
            name: "MultiEmbed",
            template: "https://multiembed.mov/?video_id={tmdb-id}&tmdb=1"
        },
        {
            id: "streamimdb",
            name: "StreamIMDb",
            template: "https://streamimdb.ru/embed/movie?tmdb={tmdb-id}"
        }
    ],

    tv: [
        {
            id: "multiembed",
            name: "MultiEmbed",
            template: "https://multiembed.mov/?video_id={tmdb-id}&tmdb=1&s={season}&e={episode}"
        },
        {
            id: "streamimdb",
            name: "StreamIMDb",
            template: "https://streamimdb.ru/embed/tv?tmdb={tmdb-id}&season={season}&episode={episode}"
        }
    ]
};