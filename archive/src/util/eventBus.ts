const eventBus = {
    on: (event: string, callback: any) => {
        document.addEventListener(event, callback)
    },
    dispatch: (event: string, data: any) => {
        document.dispatchEvent(new CustomEvent(event, { detail: data }))
    },
    remove: (event: string, callback: any) => {
        document.removeEventListener(event, callback)
    }
}

export default eventBus;