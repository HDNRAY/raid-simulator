const eventBus = {
    on: (event: string, callback: any) => {
        document.addEventListener(event, (e: any) => callback(e.detail))
    },
    dispatch: (event: string, data: any) => {
        document.dispatchEvent(new CustomEvent(event, { detail: data }))
    },
    remove: (event: string, callback: any) => {
        document.removeEventListener(event, callback)
    }
}

export default eventBus;