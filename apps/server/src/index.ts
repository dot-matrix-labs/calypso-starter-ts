export default {
    port: 31415,
    fetch() {
        return new Response(Bun.file("../web/dist/index.html"));
    },
};
console.log("Listening on http://localhost:31415");
