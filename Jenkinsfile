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
                        --env VOD-stage \
                        --reporter-junit reports/junit.xml \
                        --reporter-html reports/report.html
                '''
            }
        }
    }

post {

        always {

            echo "======================================"
            echo " Publishing Test Results"
            echo "======================================"

            junit(
                allowEmptyResults: true,
                testResults: 'reports/*-junit.xml'
            )

            archiveArtifacts(
                artifacts: 'reports/*.html',
                allowEmptyArchive: true
            )

            echo "======================================"
            echo " All Reports Published"
            echo "======================================"
        }

        success {

            echo "======================================"
            echo " ALL TESTS PASSED"
            echo "======================================"
        }

        failure {

            echo "======================================"
            echo " SOME TESTS FAILED"
            echo "======================================"
        }
    }
}
