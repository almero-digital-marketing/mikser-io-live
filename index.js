import liveServer from 'alive-server'

export function live(options = {}) {
    return ({ onLoaded, runtime, useLogger }) => {
        onLoaded(async () => {
            const logger = useLogger()
            logger.info('Starting live server')
            liveServer.start({
                wait: 1000,
                root: runtime.options.outputFolder,
                open: false,
                ...options,
            })
        })
    }
}
