export class NotificationCursor {
  value = null

  accept(next) {
    if (typeof next !== 'string' || !/^[a-f0-9]{32}:\d+$/.test(next)) return false
    if (this.value) {
      const [stream, sequence] = this.value.split(':')
      const [nextStream, nextSequence] = next.split(':')
      if (stream === nextStream && Number(nextSequence) <= Number(sequence)) return false
    }
    this.value = next
    return true
  }
}
