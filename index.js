import express from 'express';
import bodyParser from 'body-parser';

const app = express();
const port = 1234;

//app.use(bodyParser.json());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.listen(port, () => { 
  console.log(`Server is running at kox http://localhost:${port}`);
}
);