import express, { Express } from 'express'
import { AppContainer } from '@appwise/app-container'

function init (_app: Express): void {
  // sentry stuff
}

class App extends AppContainer {
  async up (): Promise<void> {
    // do stuff
  }

  async down (): Promise<void> {
    // do stuff
  }

  async populate (app: Express): Promise<void> {
    init(app)

    // do stuff

    app.use(express.urlencoded({ extended: false }))

    // add router
  }
}

const _app = new App()
