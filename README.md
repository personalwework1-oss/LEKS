# Deploy of 2a7640205b8982cf966d53c47845e5270cf4119d: success

```

WARNING! Your credentials are stored unencrypted in '/root/.docker/config.json'.
Configure a credential helper to remove this warning. See
https://docs.docker.com/go/credential-store/

 server Pulling 
 livekit Pulling 
 caddy Pulling 
 db Pulling 
 caddy Pulled 
 livekit Pulled 
 db Pulled 
 server Pulled 
 Container leks-db-1  Running
 Container leks-server-1  Recreate
 Container leks-livekit-1  Running
 Container leks-server-1  Recreated
 Container leks-caddy-1  Running
 Container leks-db-1  Waiting
 Container leks-db-1  Healthy
 Container leks-server-1  Starting
 Container leks-server-1  Started
NAME             IMAGE                                                                              COMMAND                  SERVICE   CREATED        STATUS                                     PORTS
leks-caddy-1     caddy:2                                                                            "caddy run --config …"   caddy     2 days ago     Up 2 days                                  0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/tcp, [::]:443->443/tcp, 0.0.0.0:443->443/udp, [::]:443->443/udp, 2019/tcp
leks-db-1        postgres:17                                                                        "docker-entrypoint.s…"   db        2 days ago     Up 2 days (healthy)                        5432/tcp
leks-livekit-1   livekit/livekit-server:v1.13.10                                                    "/livekit-server --c…"   livekit   2 days ago     Up 2 days                                  
leks-server-1    ghcr.io/personalwework1-oss/leks-server:2a7640205b8982cf966d53c47845e5270cf4119d   "docker-entrypoint.s…"   server    1 second ago   Up Less than a second (health: starting)   8080/tcp
calls server ok
health: {"status":"ok","database":"ok","protocol":1,"push":"on","calls":"on"}
calls path: HTTP 401 no permissions to access the room
```
