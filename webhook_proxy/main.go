package main

import (
	"io"
	"log"
	"net/http"
	"net/url"
)

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {

		// 添加 CORS 头
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, forward-domain")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		forwardDomain := r.Header.Get("forward-domain")
		log.Printf("%s %s forward-domain: %s", r.Method, r.RequestURI, forwardDomain)
		if forwardDomain == "" {
			http.Error(w, "forward-domain header required", http.StatusBadRequest)
			return
		}

		target, err := url.Parse(forwardDomain)
		if err != nil {
			http.Error(w, "invalid forward-domain", http.StatusBadRequest)
			return
		}

		proxyReq, err := http.NewRequest(r.Method, target.String()+r.RequestURI, r.Body)
		if err != nil {
			http.Error(w, "failed to create proxy request", http.StatusInternalServerError)
			return
		}
		proxyReq.Header = r.Header.Clone()
		proxyReq.Header.Del("forward-domain") // 不转发此头

		client := &http.Client{}
		resp, err := client.Do(proxyReq)
		if err != nil {
			http.Error(w, "proxy request failed: "+err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		for k, v := range resp.Header {
			for _, vv := range v {
				w.Header().Add(k, vv)
			}
		}
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	})

	log.Println("Proxy server started on :18888")
	log.Fatal(http.ListenAndServe(":18888", nil))
}
