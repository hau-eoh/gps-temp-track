import React, { useEffect, useRef } from 'react'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import './Map.css'

// Load era-widget from unpkg dynamically and expose global EraWidget
function loadEraWidget(src) {
  return new Promise((resolve, reject) => {
    if (window.EraWidget) return resolve(window.EraWidget)
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.onload = () => resolve(window.EraWidget)
    s.onerror = reject
    document.head.appendChild(s)
  })
}

export default function Map() {
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const pathRef = useRef(null)
  const lastPosRef = useRef(null)
  const eraRef = useRef(null)
  const configJSONRef = useRef(null)
  const configBUTTONRef = useRef(null)
  const valuesRef = useRef({ lat:0, lon:0, alt:0, spd:0, sat:0, button:0 })
  // include temp in tracked values
  valuesRef.current.temp = valuesRef.current.temp ?? null
  const infoControlRef = useRef(null)
  const intervalRef = useRef(null)
  const historyRef = useRef(null)

  useEffect(() => {
    // helper: parse raw payloads that may be double-encoded like {"v":"{...}", ...}
    function parseAndApplyJSON(raw, valuesRef) {
      try {
        if (!raw) return
        let outer = raw
        if (typeof outer === 'string') {
          const t = outer.trim()
          try { outer = JSON.parse(t) } catch (e) { /* leave as string */ }
        }

        // if outer has 'v' field that is a stringified JSON, parse it
        let payload = null
        if (outer && typeof outer === 'object' && outer.v) {
          let inner = outer.v
          if (typeof inner === 'string') {
            try { inner = JSON.parse(inner) } catch (e) { /* skip */ }
          }
          payload = inner
        } else {
          payload = outer
        }

        if (payload && typeof payload === 'object') {
          const cur = valuesRef.current
          if (payload.lat !== undefined) cur.lat = parseFloat(payload.lat)
          if (payload.lon !== undefined) cur.lon = parseFloat(payload.lon)
          if (payload.alt !== undefined) cur.alt = parseFloat(payload.alt)
          if (payload.spd !== undefined) cur.spd = parseFloat(payload.spd)
          if (payload.sat !== undefined) cur.sat = parseInt(payload.sat)
          if (payload.temp !== undefined) cur.temp = parseFloat(payload.temp)
        }
      } catch (e) { console.warn('parseAndApplyJSON error', e) }
    }
    // init map
    const startLat = 10.762622
    const startLng = 106.660172

    mapRef.current = L.map('map').setView([startLat, startLng], 15)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(mapRef.current)

    markerRef.current = L.marker([startLat, startLng]).addTo(mapRef.current)

    // info control
    const info = L.control({ position: 'topright' })
    info.onAdd = function () {
      this._div = L.DomUtil.create('div', 'info-box')

      // create the toggle button attached to the info box
      const btn = L.DomUtil.create('button', 'info-toggle', this._div)
      btn.type = 'button'
      btn.innerHTML = '◂'
      L.DomEvent.disableClickPropagation(btn)
      L.DomEvent.on(btn, 'click', function () {
        const div = infoControlRef.current && infoControlRef.current._div
        if (!div) return
        div.classList.toggle('collapsed')
        btn.innerHTML = div.classList.contains('collapsed') ? '▸' : '◂'
      })

      // content wrapper that will be collapsed while keeping the button visible
      this._content = L.DomUtil.create('div', 'info-content', this._div)

      this.update = function () {
        const v = valuesRef.current
        const color = getGradientColor(v.spd)
        const tempHtml = v.temp != null ? `\n            <div class="info-item"><span>Temp:</span><span class="info-value">${v.temp.toFixed(1)} °C</span></div>` : ''
        this._content.innerHTML = `
          <div class="info-title">🚀 GPS MONITOR AA</div>
          <div class="info-item">
            <span>Speed:</span>
            <span class="info-value" style="color: ${color}">
              ${v.spd.toFixed(1)} km/h
            </span>
          </div>
          <div class="info-item">
            <span>Alt:</span>
            <span class="info-value">${v.alt.toFixed(1)} m</span>
          </div>
          ${tempHtml}
          <div class="info-item">
            <span>Sats:</span>
            <span class="info-value">${v.sat}</span>
          </div>
          <div class="info-item" style="font-size:11px; color:#666; margin-top:5px">
            Lat: ${v.lat.toFixed(5)}, Lon: ${v.lon.toFixed(5)}
          </div>
        `
      }

      this.update()
      return this._div
    }
    info.addTo(mapRef.current)
    infoControlRef.current = info

    // load era widget and init
    let mounted = true
    loadEraWidget('https://www.unpkg.com/@eohjsc/era-widget@1.1.3/src/index.js')
      .then(() => {
        if (!mounted) return
        try {
          const era = new window.EraWidget()
          eraRef.current = era

          // helper to request histories (24h by default)
          function requestInitialHistories(hours = 24) {
            try {
              const endTime = Date.now()
              const startTime = endTime - hours * 60 * 60 * 1000
              if (eraRef.current && eraRef.current.requestHistories) {
                eraRef.current.requestHistories(startTime, endTime)
              }
            } catch (e) { console.warn('requestInitialHistories error', e) }
          }

          era.init({
            onConfiguration: (configuration) => {
              // store references to expected realtime configs
              configJSONRef.current = configuration.realtime_configs && configuration.realtime_configs[0]
              configBUTTONRef.current = configuration.realtime_configs && configuration.realtime_configs[1]

              // request historical data once configuration is known
              requestInitialHistories(24)
            },

            onValues: (values) => {
              // Sometimes onValues may arrive before configuration; attempt to parse any JSON payloads
              try {
                // 1) If known config id exists, prefer it
                if (configBUTTONRef.current && values[configBUTTONRef.current.id]) {
                  valuesRef.current.button = parseInt(values[configBUTTONRef.current.id].value)
                }

                if (configJSONRef.current && values[configJSONRef.current.id]) {
                  const raw = values[configJSONRef.current.id].value
                  parseAndApplyJSON(raw, valuesRef)
                } else {
                  // 2) fallback: inspect all values, try to find a JSON string containing lat/lon
                  for (const k in values) {
                    const entry = values[k]
                    if (!entry || !entry.value) continue
                    const v = entry.value
                    if (typeof v === 'string' && v.trim().startsWith('{')) {
                      // try parse JSON
                      parseAndApplyJSON(v, valuesRef)
                    }
                  }
                }
              } catch (e) { console.warn('onValues parsing error', e) }

              // update info box and marker immediately
              if (infoControlRef.current) infoControlRef.current.update()
              const vcur = valuesRef.current
              if (vcur.lat && vcur.lon && markerRef.current) {
                markerRef.current.setLatLng([vcur.lat, vcur.lon])
                mapRef.current.panTo([vcur.lat, vcur.lon])
              }
            },

            onHistories: (history) => {
              try {
                // history is an array of history streams; iterate and parse values into lat/lon
                const allPoints = []
                history.forEach((stream) => {
                  const data = stream && stream.data ? stream.data : []
                  data.forEach((item) => {
                    // item may be [ts, value] or an object with {timestamp, value} or {value}
                    let rawValue = null
                    if (Array.isArray(item) && item.length >= 2) {
                      rawValue = item[1]
                    } else if (item && typeof item === 'object') {
                      rawValue = item.value !== undefined ? item.value : (item[1] || null)
                    }
                    if (rawValue == null) return
                    try {
                      const parsed = typeof rawValue === 'string' && rawValue.trim().startsWith('{') ? JSON.parse(rawValue) : null
                      if (parsed && parsed.lat !== undefined && parsed.lon !== undefined) {
                        allPoints.push([parseFloat(parsed.lat), parseFloat(parsed.lon)])
                      }
                    } catch (e) {
                      // not JSON — skip
                    }
                  })
                })

                if (allPoints.length) {
                  // remove previous history layer
                  if (historyRef.current) historyRef.current.remove()
                  historyRef.current = L.polyline(allPoints, { color: '#666', weight: 4, opacity: 0.6 }).addTo(mapRef.current)
                } else {
                  console.log('No usable historical lat/lon points found')
                }
              } catch (e) { console.warn('onHistories error', e) }
            }
          })
        } catch (e) {
          console.error('EraWidget init error', e)
        }
      })
      .catch((err) => console.warn('Failed to load EraWidget', err))

    // periodic map updater
    intervalRef.current = setInterval(() => {
      const v = valuesRef.current
      if (v.lat && v.lon && v.lat !== 0 && v.lon !== 0) {
        const newLatLng = [v.lat, v.lon]
        markerRef.current.setLatLng(newLatLng)
        mapRef.current.panTo(newLatLng)

        const color = getGradientColor(v.spd)
        const tempHtml = v.temp != null ? `Temp: ${v.temp.toFixed(1)} °C<br>` : ''
        markerRef.current.bindPopup(`<div style="text-align:center"><b style="color:${color}">${v.spd.toFixed(1)} km/h</b><br>${tempHtml}Alt: ${v.alt} m</div>`)

        if (v.button === 1) {
          if (!pathRef.current || color !== pathRef.current.options.color) {
            // start new polyline
            if (pathRef.current) pathRef.current.remove()
            pathRef.current = L.polyline([], { color, weight:6, opacity:0.9, lineCap: 'round', smoothFactor:1 }).addTo(mapRef.current)
            if (lastPosRef.current) pathRef.current.setLatLngs([lastPosRef.current])
          }
          // append
          const latlngs = pathRef.current.getLatLngs ? pathRef.current.getLatLngs() : []
          latlngs.push(newLatLng)
          pathRef.current.setLatLngs(latlngs)
          lastPosRef.current = newLatLng
        } else {
          if (pathRef.current) { pathRef.current.remove(); pathRef.current = null }
          lastPosRef.current = null
        }
      }
    }, 1000)

    return () => {
      mounted = false
      clearInterval(intervalRef.current)
      if (eraRef.current && eraRef.current.destroy) eraRef.current.destroy()
      if (mapRef.current) mapRef.current.remove()
    }
  }, [])

  return (
    <div id="map" style={{height: '100vh'}} />
  )
}

function getGradientColor(speed) {
  const stops = [
    { speed: 0,   color: [0, 0, 255] },
    { speed: 40,  color: [0, 255, 0] },
    { speed: 70,  color: [255, 165, 0] },
    { speed: 100, color: [255, 0, 0] },
    { speed: 120, color: [148, 0, 211] }
  ]
  if (speed <= 0) return `rgb(${stops[0].color.join(',')})`
  if (speed >= 120) return `rgb(${stops[stops.length-1].color.join(',')})`
  for (let i=0;i<stops.length-1;i++){
    const start = stops[i], end = stops[i+1]
    if (speed >= start.speed && speed <= end.speed) {
      const factor = (speed - start.speed) / (end.speed - start.speed)
      const r = Math.round(start.color[0] + factor*(end.color[0]-start.color[0]))
      const g = Math.round(start.color[1] + factor*(end.color[1]-start.color[1]))
      const b = Math.round(start.color[2] + factor*(end.color[2]-start.color[2]))
      return `rgb(${r}, ${g}, ${b})`
    }
  }
  return 'rgb(0,0,255)'
}
