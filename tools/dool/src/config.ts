const config = {
    useSocket: false
} as any

type Config = 'useSocket'

export function getConfig(key: Config) {
    return config[key]
}

export function setConfig(key: Config, value: any) {
    config[key] = value
}

export function getAllConfig() {
    return config
}
