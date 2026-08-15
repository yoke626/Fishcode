// Startup loading page: shows backend status pushed from the main process and
// ticks an elapsed-seconds counter so the wait never reads as a freeze. The
// main process navigates to the dsh UI once the backend is ready.
(function () {
  'use strict'

  var statusEl = document.getElementById('status')
  var elapsedEl = document.getElementById('elapsed')
  var retryBtn = document.getElementById('retry')

  var startedAt = Date.now()
  var failed = false

  function tick() {
    if (failed) return
    var seconds = Math.round((Date.now() - startedAt) / 1000)
    if (seconds < 2) {
      elapsedEl.textContent = ''
      return
    }
    elapsedEl.textContent = '已等待 ' + seconds + ' 秒，首次启动会慢一些'
  }
  setInterval(tick, 500)

  var api = window.loadingAPI
  if (api) {
    api.onState(function (state) {
      if (state === 'failed') {
        failed = true
        document.body.className = 'failed'
        statusEl.textContent = '本地服务启动失败'
        elapsedEl.textContent = ''
        retryBtn.hidden = false
        return
      }
      failed = false
      document.body.className = ''
      retryBtn.hidden = true
      if (state === 'restarting') {
        statusEl.textContent = '本地服务重启中…'
      } else {
        startedAt = Date.now()
        statusEl.textContent = '正在启动本地服务…'
      }
    })
  }

  retryBtn.addEventListener('click', function () {
    if (failed) {
      failed = false
      document.body.className = ''
      retryBtn.hidden = true
      startedAt = Date.now()
      statusEl.textContent = '正在启动本地服务…'
      if (api) api.retry()
    }
  })
})()
