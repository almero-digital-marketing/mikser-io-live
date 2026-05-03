import liveServer from 'alive-server'

export default ({ onLoaded, runtime, useLogger }) => {
    onLoaded(async () => {
        const logger = useLogger()
        logger.info('Starting live server')
        liveServer.start({
            wait: 1000,
            root: runtime.options.outputFolder,
            open: false,
            ...runtime.config.live,
        })
    })
}