pipeline {
    agent any

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Check Environment') {
            steps {
                sh '''
                    node --version
                    npm --version
                    bru --version
                '''
            }
        }

        stage('Prepare Reports') {
            steps {
                sh '''
                    mkdir -p reports
                '''
            }
        }

        stage('Run Bruno') {
            steps {
                sh '''
                    bru run . \
                        --env Vod-stage \
                        --reporter-junit reports/junit.xml \
                        --reporter-html reports/report.html
                '''
            }
        }
    }

    post {

        always {

            junit 'reports/junit.xml'

            archiveArtifacts artifacts: 'reports/report.html',
                             allowEmptyArchive: true

        }
    }
}
